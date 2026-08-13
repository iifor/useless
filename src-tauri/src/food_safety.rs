use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSeatTarget {
    id: String,
    name: String,
    kind: String,
    path: Option<String>,
    app_owned: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFoodTarget {
    name: String,
    kind: String,
    path: String,
    selection_token: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum FoodObjectKind {
    File,
    Folder,
}

impl FoodObjectKind {
    fn from_metadata(metadata: &fs::Metadata) -> Result<Self, String> {
        if metadata.is_file() {
            Ok(Self::File)
        } else if metadata.is_dir() {
            Ok(Self::Folder)
        } else {
            Err("目标不是普通文件或文件夹".into())
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Folder => "folder",
        }
    }
}

#[derive(Clone, Debug)]
struct SelectedUserFood {
    path: PathBuf,
    kind: FoodObjectKind,
    identity: String,
}

#[derive(Default)]
struct FoodSelectionState {
    next_token: u64,
    selected: HashMap<String, SelectedUserFood>,
}

#[derive(Default)]
struct FoodSelectionRegistry {
    state: Mutex<FoodSelectionState>,
}

fn food_stage_error(stage: &str, error: impl std::fmt::Display) -> String {
    format!("[{stage}] {error}")
}

fn record_last_food_error(data: &Path, error: &str) -> Result<(), String> {
    fs::write(data.join("last-food-error.txt"), error).map_err(|write_error| write_error.to_string())
}

impl FoodSelectionRegistry {
    fn inspect(&self, safety: &FoodSafety, path: &Path) -> Result<UserFoodTarget, String> {
        let canonical = safety.validate_user_food(path)?;
        let metadata = fs::symlink_metadata(&canonical).map_err(|error| error.to_string())?;
        let kind = FoodObjectKind::from_metadata(&metadata)?;
        let identity = file_identity(&canonical, &metadata)?;
        let name = canonical
            .file_name()
            .ok_or_else(|| "目标名称无效".to_owned())?
            .to_string_lossy()
            .into_owned();
        let mut state = self
            .state
            .lock()
            .map_err(|_| "文件选择状态不可用".to_owned())?;
        state.next_token = state
            .next_token
            .checked_add(1)
            .ok_or_else(|| "文件选择令牌已耗尽".to_owned())?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let token = format!("{:x}-{:x}-{:x}", std::process::id(), now, state.next_token);
        state.selected.insert(
            token.clone(),
            SelectedUserFood {
                path: canonical.clone(),
                kind: kind.clone(),
                identity,
            },
        );
        Ok(UserFoodTarget {
            name,
            kind: kind.as_str().into(),
            path: path.to_string_lossy().into_owned(),
            selection_token: token,
        })
    }

    fn trash_with(
        &self,
        safety: &FoodSafety,
        path: &Path,
        selection_token: &str,
        move_to_trash: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        let selected = self
            .state
            .lock()
            .map_err(|_| food_stage_error("确认-选择状态", "文件选择状态不可用"))?
            .selected
            .remove(selection_token)
            .ok_or_else(|| food_stage_error("确认-选择令牌", "文件选择已失效"))?;
        let canonical = safety
            .validate_user_food(path)
            .map_err(|error| food_stage_error("确认-路径复核", error))?;
        let metadata = fs::symlink_metadata(&canonical)
            .map_err(|error| food_stage_error("确认-元数据", error))?;
        let kind = FoodObjectKind::from_metadata(&metadata)
            .map_err(|error| food_stage_error("确认-文件类型", error))?;
        let identity = file_identity(&canonical, &metadata)
            .map_err(|error| food_stage_error("确认-文件身份", error))?;
        if canonical != selected.path || kind != selected.kind || identity != selected.identity {
            return Err(food_stage_error(
                "确认-文件身份",
                "所选文件已被替换或路径不匹配",
            ));
        }
        move_to_trash(&canonical).map_err(|error| food_stage_error("确认-Windows回收站", error))
    }
}

fn food_selections() -> &'static FoodSelectionRegistry {
    static SELECTIONS: OnceLock<FoodSelectionRegistry> = OnceLock::new();
    SELECTIONS.get_or_init(FoodSelectionRegistry::default)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct OwnedSeat {
    path: PathBuf,
    modified_nanos: u64,
    created_nanos: Option<u64>,
    identity: String,
    permissions: u64,
    readonly: bool,
}

pub struct FoodSafety {
    home: PathBuf,
    desktop: PathBuf,
    data: PathBuf,
    manifest: PathBuf,
    owned: Vec<OwnedSeat>,
}

impl FoodSafety {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        let home = app.path().home_dir().map_err(|error| error.to_string())?;
        let desktop = app
            .path()
            .desktop_dir()
            .map_err(|error| error.to_string())?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(&data).map_err(|error| error.to_string())?;
        Self::new(home, desktop, data)
    }

    fn new(home: PathBuf, desktop: PathBuf, data: PathBuf) -> Result<Self, String> {
        let manifest = data.join("owned-seat-files.json");
        let owned = match fs::read(&manifest) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                eprintln!("忽略损坏的宠物座位所有权清单（安全保留原文件）: {error}");
                Vec::new()
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self {
            home: home.canonicalize().map_err(|error| error.to_string())?,
            desktop: desktop.canonicalize().map_err(|error| error.to_string())?,
            data: data.canonicalize().map_err(|error| error.to_string())?,
            manifest,
            owned,
        })
    }

    fn save(&self) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(&self.owned).map_err(|error| error.to_string())?;
        let parent = self
            .manifest
            .parent()
            .ok_or_else(|| "所有权清单路径无效".to_owned())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        temporary
            .write_all(&bytes)
            .map_err(|error| error.to_string())?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| error.to_string())?;
        temporary
            .persist(&self.manifest)
            .map_err(|error| error.error.to_string())?;
        Ok(())
    }

    fn create_owned_seat_file(&mut self) -> Result<PathBuf, String> {
        for suffix in 1..=10_000 {
            let name = if suffix == 1 {
                "宠物的座位.tmp".to_owned()
            } else {
                format!("宠物的座位-{suffix}.tmp")
            };
            let path = self.desktop.join(name);
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(_) => {
                    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
                    let metadata =
                        fs::symlink_metadata(&canonical).map_err(|error| error.to_string())?;
                    self.owned.push(OwnedSeat {
                        path: canonical.clone(),
                        modified_nanos: modified_nanos(&metadata)?,
                        created_nanos: created_nanos(&metadata),
                        identity: file_identity(&canonical, &metadata)?,
                        permissions: permission_fingerprint(&metadata),
                        readonly: metadata.permissions().readonly(),
                    });
                    if let Err(error) = self.save() {
                        self.owned.pop();
                        let _ = trash::delete(&canonical);
                        return Err(error);
                    }
                    return Ok(canonical);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.to_string()),
            }
        }
        Err("无法为宠物座位找到安全文件名".into())
    }

    fn validate_owned(&self, path: &Path) -> Result<PathBuf, String> {
        let link_metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        if link_metadata.file_type().is_symlink() {
            return Err("拒绝处理符号链接".into());
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        let desktop = self
            .desktop
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if canonical.parent() != Some(desktop.as_path()) {
            return Err("座位文件不在桌面".into());
        }
        let record = self
            .owned
            .iter()
            .find(|record| record.path == canonical)
            .ok_or_else(|| "座位文件不属于本应用".to_owned())?;
        let metadata = fs::symlink_metadata(&canonical).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() != 0 {
            return Err("座位文件不再是空普通文件".into());
        }
        if modified_nanos(&metadata)? != record.modified_nanos
            || created_nanos(&metadata) != record.created_nanos
            || file_identity(&canonical, &metadata)? != record.identity
            || permission_fingerprint(&metadata) != record.permissions
            || metadata.permissions().readonly() != record.readonly
        {
            return Err("座位文件已被用户修改".into());
        }
        Ok(canonical)
    }

    fn validate_user_food(&self, path: &Path) -> Result<PathBuf, String> {
        let link_metadata = metadata_without_symlink_components(path)?;
        if !link_metadata.is_file() && !link_metadata.is_dir() {
            return Err("目标不是普通文件或文件夹".into());
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        if canonical == self.home {
            return Err("拒绝处理用户主目录".into());
        }
        if canonical == self.desktop {
            return Err("拒绝处理桌面目录".into());
        }
        if canonical.starts_with(&self.data) || self.data.starts_with(&canonical) {
            return Err("拒绝处理应用数据".into());
        }
        if canonical.parent().is_none() || is_volume_root(&canonical)? {
            return Err("拒绝处理卷根目录".into());
        }
        if is_system_protected(&canonical)? {
            return Err("拒绝处理系统目录".into());
        }
        Ok(canonical)
    }

    fn trash_owned_with(
        &mut self,
        path: &Path,
        move_to_trash: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
        let canonical = self.validate_owned(path)?;
        move_to_trash(&canonical)?;
        self.owned.retain(|record| record.path != canonical);
        self.save()
    }

    fn cleanup_owned_with(
        &mut self,
        move_to_trash: impl Fn(&Path) -> Result<(), String>,
    ) -> Result<usize, String> {
        let paths: Vec<PathBuf> = self
            .owned
            .iter()
            .map(|record| record.path.clone())
            .collect();
        let mut cleaned = 0;
        for path in paths {
            match self.validate_owned(&path) {
                Ok(canonical) => {
                    if move_to_trash(&canonical).is_ok() {
                        self.owned.retain(|record| record.path != canonical);
                        cleaned += 1;
                    }
                }
                Err(_) => self.owned.retain(|record| record.path != path),
            }
        }
        self.save()?;
        Ok(cleaned)
    }
}

fn metadata_without_symlink_components(path: &Path) -> Result<fs::Metadata, String> {
    if !path.is_absolute() {
        return Err("目标路径必须是绝对路径".into());
    }
    let mut prefix = PathBuf::new();
    let mut final_metadata = None;
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                prefix.push(component.as_os_str());
            }
            Component::CurDir | Component::ParentDir => {
                return Err("目标路径包含不安全的路径组件".into());
            }
        }
        if !prefix.is_absolute() {
            continue;
        }
        let metadata = fs::symlink_metadata(&prefix).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("拒绝处理包含符号链接的路径".into());
        }
        final_metadata = Some(metadata);
    }
    final_metadata.ok_or_else(|| "目标路径无效".to_owned())
}

#[cfg(any(windows, test))]
fn windows_system_protected_roots_with(
    system_root: Option<PathBuf>,
    canonicalize: impl FnOnce(&Path) -> std::io::Result<PathBuf>,
) -> Result<Vec<PathBuf>, String> {
    let system_root = system_root.ok_or_else(|| "无法确定 Windows 系统目录".to_owned())?;
    Ok(vec![
        canonicalize(&system_root).map_err(|error| error.to_string())?
    ])
}

fn system_protected_roots() -> Result<Vec<PathBuf>, String> {
    #[cfg(target_os = "macos")]
    let roots: Result<Vec<PathBuf>, String> = ["/System", "/Library", "/private"]
        .into_iter()
        .map(PathBuf::from)
        .map(|root| root.canonicalize().map_err(|error| error.to_string()))
        .collect();

    #[cfg(windows)]
    let roots = windows_system_protected_roots_with(
        std::env::var_os("SystemRoot").map(PathBuf::from),
        |path| fs::canonicalize(path),
    );

    #[cfg(not(any(target_os = "macos", windows)))]
    let roots = Ok(Vec::new());

    roots
}

fn is_system_protected(path: &Path) -> Result<bool, String> {
    Ok(system_protected_roots()?
        .iter()
        .any(|root| path.starts_with(root)))
}

#[cfg(any(target_os = "linux", test))]
fn unescape_linux_mountinfo_field(field: &str) -> Result<String, String> {
    let bytes = field.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'\\' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let digits = bytes
            .get(index + 1..index + 4)
            .ok_or_else(|| "mountinfo 转义不完整".to_owned())?;
        if !digits.iter().all(|digit| (b'0'..=b'7').contains(digit)) {
            return Err("mountinfo 转义无效".into());
        }
        let value = u16::from(digits[0] - b'0') * 64
            + u16::from(digits[1] - b'0') * 8
            + u16::from(digits[2] - b'0');
        decoded.push(u8::try_from(value).map_err(|_| "mountinfo 转义超出范围".to_owned())?);
        index += 4;
    }
    String::from_utf8(decoded).map_err(|error| error.to_string())
}

#[cfg(any(target_os = "linux", test))]
fn linux_mountinfo_has_mount_point(mountinfo: &str, path: &Path) -> Result<bool, String> {
    let mut found = false;
    let mut saw_line = false;
    for line in mountinfo.lines() {
        saw_line = true;
        let fields: Vec<_> = line.split_ascii_whitespace().collect();
        if fields.len() < 10 {
            return Err("mountinfo 字段不足".into());
        }
        fields[0]
            .parse::<u64>()
            .map_err(|error| error.to_string())?;
        fields[1]
            .parse::<u64>()
            .map_err(|error| error.to_string())?;
        let mut device = fields[2].split(':');
        device
            .next()
            .ok_or_else(|| "mountinfo 设备号无效".to_owned())?
            .parse::<u64>()
            .map_err(|error| error.to_string())?;
        device
            .next()
            .ok_or_else(|| "mountinfo 设备号无效".to_owned())?
            .parse::<u64>()
            .map_err(|error| error.to_string())?;
        if device.next().is_some() {
            return Err("mountinfo 设备号无效".into());
        }
        unescape_linux_mountinfo_field(fields[3])?;
        let mount_point = unescape_linux_mountinfo_field(fields[4])?;
        if !mount_point.starts_with('/') {
            return Err("mountinfo 挂载点不是绝对路径".into());
        }
        let mount_point = PathBuf::from(mount_point);
        let separator = fields
            .iter()
            .position(|field| *field == "-")
            .ok_or_else(|| "mountinfo 缺少分隔符".to_owned())?;
        if separator < 6 || separator + 3 >= fields.len() {
            return Err("mountinfo 结构无效".into());
        }
        found |= mount_point == path;
    }
    if !saw_line {
        return Err("mountinfo 为空".into());
    }
    Ok(found)
}

#[cfg(any(all(unix, not(target_os = "linux")), test))]
fn unix_volume_root_with(
    path: &Path,
    device_of: impl Fn(&Path) -> Result<u64, String>,
) -> Result<bool, String> {
    let Some(parent) = path.parent() else {
        return Ok(true);
    };
    Ok(device_of(path)? != device_of(parent)?)
}

#[cfg(target_os = "linux")]
fn is_volume_root(path: &Path) -> Result<bool, String> {
    let mountinfo =
        fs::read_to_string("/proc/self/mountinfo").map_err(|error| error.to_string())?;
    linux_mountinfo_has_mount_point(&mountinfo, path)
}

#[cfg(all(unix, not(target_os = "linux")))]
fn is_volume_root(path: &Path) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    if path == Path::new("/Volumes") || path.parent() == Some(Path::new("/Volumes")) {
        return Ok(true);
    }

    use std::os::unix::fs::MetadataExt;
    unix_volume_root_with(path, |candidate| {
        fs::metadata(candidate)
            .map(|metadata| metadata.dev())
            .map_err(|error| error.to_string())
    })
}

#[cfg(windows)]
fn is_volume_root(path: &Path) -> Result<bool, String> {
    Ok(path.parent().is_none())
}

#[cfg(not(any(unix, windows)))]
fn is_volume_root(path: &Path) -> Result<bool, String> {
    Ok(path.parent().is_none())
}

fn modified_nanos(metadata: &fs::Metadata) -> Result<u64, String> {
    let nanos = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    u64::try_from(nanos).map_err(|_| "文件时间戳超出范围".to_owned())
}

fn created_nanos(metadata: &fs::Metadata) -> Option<u64> {
    let nanos = metadata
        .created()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    u64::try_from(nanos).ok()
}

#[cfg(unix)]
fn file_identity(_path: &Path, metadata: &fs::Metadata) -> Result<String, String> {
    use std::os::unix::fs::MetadataExt;
    Ok(format!("{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(windows)]
fn file_identity(path: &Path, _metadata: &fs::Metadata) -> Result<String, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE,
            FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
        },
    };

    let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            wide_path.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().to_string());
    }

    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let query_result = unsafe { GetFileInformationByHandle(handle, &mut information) };
    let query_error = (query_result == 0).then(std::io::Error::last_os_error);
    let close_result = unsafe { CloseHandle(handle) };
    if let Some(error) = query_error {
        return Err(error.to_string());
    }
    if close_result == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }

    let volume = information.dwVolumeSerialNumber;
    let index = (u64::from(information.nFileIndexHigh) << 32)
        | u64::from(information.nFileIndexLow);
    Ok(format!("{volume}:{index}"))
}

#[cfg(unix)]
fn permission_fingerprint(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    u64::from(metadata.mode())
}

#[cfg(windows)]
fn permission_fingerprint(metadata: &fs::Metadata) -> u64 {
    use std::os::windows::fs::MetadataExt;
    u64::from(metadata.file_attributes())
}

fn is_application_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        ".app",
        ".appimage",
        ".bat",
        ".bundle",
        ".cmd",
        ".com",
        ".command",
        ".deb",
        ".desktop",
        ".dmg",
        ".exe",
        ".framework",
        ".jar",
        ".lnk",
        ".msi",
        ".pkg",
        ".plugin",
        ".ps1",
        ".rpm",
        ".scr",
        ".url",
    ]
    .iter()
    .any(|extension| lower.ends_with(extension))
}

#[cfg(target_os = "macos")]
fn is_os_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::macos::fs::MetadataExt;
    metadata.st_flags() & 0x0000_8000 != 0
}

#[cfg(windows)]
fn is_os_hidden(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & (0x2 | 0x4) != 0
}

#[cfg(not(any(target_os = "macos", windows)))]
fn is_os_hidden(_metadata: &fs::Metadata) -> bool {
    false
}

#[tauri::command]
pub fn find_seat_candidates(app: AppHandle) -> Result<Vec<DesktopSeatTarget>, String> {
    let safety = FoodSafety::from_app(&app)?;
    let entries = fs::read_dir(&safety.desktop).map_err(|error| error.to_string())?;
    let mut targets = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || is_application_name(&name) {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
            continue;
        }
        if is_os_hidden(&metadata) {
            continue;
        }
        let path = entry.path();
        targets.push(DesktopSeatTarget {
            id: path.to_string_lossy().into_owned(),
            name,
            kind: if metadata.is_dir() { "folder" } else { "file" }.into(),
            path: Some(path.to_string_lossy().into_owned()),
            app_owned: false,
        });
    }
    Ok(targets)
}

#[tauri::command]
pub fn create_owned_seat_file(app: AppHandle) -> Result<DesktopSeatTarget, String> {
    let mut safety = FoodSafety::from_app(&app)?;
    let path = safety.create_owned_seat_file()?;
    Ok(DesktopSeatTarget {
        id: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        kind: "owned-temp".into(),
        path: Some(path.to_string_lossy().into_owned()),
        app_owned: true,
    })
}

fn run_trash_operation<T>(operation: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String>
where
    T: Send + 'static,
{
    std::thread::Builder::new()
        .name("uno-trash".into())
        .spawn(operation)
        .map_err(|error| format!("无法启动回收站线程: {error}"))?
        .join()
        .map_err(|_| "回收站线程异常退出".to_owned())?
}

#[cfg(windows)]
fn recycle_path(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FO_DELETE, SHFILEOPSTRUCTW,
        SHFileOperationW,
    };

    let mut wide_path: Vec<u16> = path.as_os_str().encode_wide().collect();
    let device_prefix = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    let unc_prefix = [
        b'\\' as u16,
        b'\\' as u16,
        b'?' as u16,
        b'\\' as u16,
        b'U' as u16,
        b'N' as u16,
        b'C' as u16,
        b'\\' as u16,
    ];
    if wide_path.starts_with(&unc_prefix) {
        wide_path.drain(..unc_prefix.len());
        wide_path.splice(0..0, [b'\\' as u16, b'\\' as u16]);
    } else if wide_path.starts_with(&device_prefix) {
        wide_path.drain(..device_prefix.len());
    }
    wide_path.extend([0, 0]);

    let mut operation = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: wide_path.as_ptr(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI) as u16,
        ..Default::default()
    };
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 {
        return Err(format!("Windows 回收站操作失败（SHFileOperationW，代码 {result}）"));
    }
    if operation.fAnyOperationsAborted != 0 {
        return Err("Windows 回收站操作被系统中止，文件已保留".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn recycle_path(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|error| error.to_string())
}

fn move_to_trash(path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();
    run_trash_operation(move || recycle_path(&path))
}

#[tauri::command]
pub fn trash_owned_seat_file(app: AppHandle, path: String) -> Result<(), String> {
    FoodSafety::from_app(&app)?.trash_owned_with(Path::new(&path), move_to_trash)
}

#[tauri::command]
pub fn inspect_user_food(app: AppHandle, path: String) -> Result<UserFoodTarget, String> {
    let safety = FoodSafety::from_app(&app)?;
    food_selections().inspect(&safety, Path::new(&path))
}

#[tauri::command]
pub fn trash_user_food(
    app: AppHandle,
    path: String,
    selection_token: String,
) -> Result<(), String> {
    let safety = FoodSafety::from_app(&app)
        .map_err(|error| food_stage_error("确认-应用目录", error))?;
    let result =
        food_selections().trash_with(&safety, Path::new(&path), &selection_token, move_to_trash);
    if let Err(error) = &result {
        let _ = record_last_food_error(&safety.data, error);
    }
    result
}

pub fn cleanup_owned_seat_files(app: &AppHandle) -> Result<usize, String> {
    FoodSafety::from_app(app)?.cleanup_owned_with(move_to_trash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    static NEXT_TEST_DIR: AtomicU64 = AtomicU64::new(0);

    struct TestDirs {
        root: PathBuf,
        home: PathBuf,
        desktop: PathBuf,
        data: PathBuf,
    }

    impl TestDirs {
        fn new() -> Self {
            let root = std::env::current_dir()
                .unwrap()
                .join("target/food-safety-tests")
                .join(format!(
                    "black-shirt-pet-{}-{}",
                    std::process::id(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                        + u128::from(NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed)),
                ));
            let home = root.join("Home");
            let desktop = home.join("Desktop");
            let data = root.join("Data");
            fs::create_dir_all(&desktop).unwrap();
            fs::create_dir_all(&data).unwrap();
            Self {
                root,
                home,
                desktop,
                data,
            }
        }

        fn safety(&self) -> FoodSafety {
            FoodSafety::new(self.home.clone(), self.desktop.clone(), self.data.clone()).unwrap()
        }
    }

    impl Drop for TestDirs {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn collision_never_overwrites_an_unknown_file() {
        let dirs = TestDirs::new();
        fs::write(dirs.desktop.join("宠物的座位.tmp"), "mine").unwrap();
        let created = dirs.safety().create_owned_seat_file().unwrap();
        assert_eq!(
            fs::read_to_string(dirs.desktop.join("宠物的座位.tmp")).unwrap(),
            "mine"
        );
        assert_eq!(created.file_name().unwrap(), "宠物的座位-2.tmp");
    }

    #[test]
    fn only_owned_unchanged_empty_desktop_files_can_be_trashed() {
        let dirs = TestDirs::new();
        let mut safety = dirs.safety();
        let owned = safety.create_owned_seat_file().unwrap();
        let mut moved = false;
        safety
            .trash_owned_with(&owned, |_| {
                moved = true;
                Ok(())
            })
            .unwrap();
        assert!(moved);

        let unknown = dirs.desktop.join("unknown.tmp");
        fs::write(&unknown, []).unwrap();
        assert!(safety.trash_owned_with(&unknown, |_| Ok(())).is_err());
    }

    #[test]
    fn unchanged_selected_file_and_nonempty_folder_can_be_trashed_once() {
        let dirs = TestDirs::new();
        let file = dirs.desktop.join("food.txt");
        let folder = dirs.desktop.join("FoodFolder");
        fs::write(&file, "food").unwrap();
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("inside.txt"), "food").unwrap();
        let safety = dirs.safety();
        let selections = FoodSelectionRegistry::default();
        let selected_file = selections.inspect(&safety, &file).unwrap();
        let selected_folder = selections.inspect(&safety, &folder).unwrap();
        let mut moved = Vec::new();
        selections
            .trash_with(&safety, &file, &selected_file.selection_token, |path| {
                moved.push(path.to_path_buf());
                Ok(())
            })
            .unwrap();
        selections
            .trash_with(&safety, &folder, &selected_folder.selection_token, |path| {
                moved.push(path.to_path_buf());
                Ok(())
            })
            .unwrap();

        assert_eq!(
            moved,
            vec![file.canonicalize().unwrap(), folder.canonicalize().unwrap()]
        );
        assert!(selections
            .trash_with(&safety, &file, &selected_file.selection_token, |_| Ok(()))
            .is_err());
    }

    #[test]
    fn replacing_selected_food_at_the_same_path_is_refused() {
        let dirs = TestDirs::new();
        let file = dirs.desktop.join("food.txt");
        let original = dirs.desktop.join("original.txt");
        fs::write(&file, "original").unwrap();
        let safety = dirs.safety();
        let selections = FoodSelectionRegistry::default();
        let selected = selections.inspect(&safety, &file).unwrap();
        fs::rename(&file, &original).unwrap();
        fs::write(&file, "replacement").unwrap();
        let mut moved = false;

        assert!(selections
            .trash_with(&safety, &file, &selected.selection_token, |_| {
                moved = true;
                Ok(())
            })
            .is_err());
        assert!(!moved);
        assert_eq!(fs::read_to_string(&file).unwrap(), "replacement");
    }

    #[test]
    fn selection_token_cannot_be_used_for_a_different_path_or_replayed() {
        let dirs = TestDirs::new();
        let first = dirs.desktop.join("first.txt");
        let second = dirs.desktop.join("second.txt");
        fs::write(&first, "first").unwrap();
        fs::write(&second, "second").unwrap();
        let safety = dirs.safety();
        let selections = FoodSelectionRegistry::default();
        let selected = selections.inspect(&safety, &first).unwrap();
        let mut moved = false;

        assert!(selections
            .trash_with(&safety, &second, &selected.selection_token, |_| {
                moved = true;
                Ok(())
            })
            .is_err());
        assert!(selections
            .trash_with(&safety, &first, &selected.selection_token, |_| {
                moved = true;
                Ok(())
            })
            .is_err());
        assert!(!moved);
    }

    #[cfg(windows)]
    #[test]
    fn canonical_path_returned_to_frontend_survives_confirmation() {
        let dirs = TestDirs::new();
        let file = dirs.desktop.join("frontend-roundtrip.txt");
        fs::write(&file, "food").unwrap();
        let safety = dirs.safety();
        let selections = FoodSelectionRegistry::default();
        let selected = selections.inspect(&safety, &file).unwrap();
        let mut moved = false;

        selections
            .trash_with(
                &safety,
                Path::new(&selected.path),
                &selected.selection_token,
                |_| {
                    moved = true;
                    Ok(())
                },
            )
            .unwrap();

        assert!(moved);
    }

    #[test]
    fn protected_missing_and_symlink_targets_are_rejected() {
        let dirs = TestDirs::new();
        fs::create_dir_all(dirs.data.join("nested")).unwrap();
        let safety = dirs.safety();
        assert!(safety.validate_user_food(&dirs.home).is_err());
        assert!(safety.validate_user_food(&dirs.desktop).is_err());
        assert!(safety.validate_user_food(&dirs.data).is_err());
        assert!(safety
            .validate_user_food(&dirs.data.join("nested"))
            .is_err());
        assert!(safety
            .validate_user_food(&dirs.desktop.join("missing"))
            .is_err());
    }

    #[test]
    fn app_data_ancestors_are_rejected() {
        let dirs = TestDirs::new();
        let safety = dirs.safety();
        assert!(safety
            .validate_user_food(dirs.data.parent().unwrap())
            .is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_system_trees_and_volume_roots_are_protected() {
        assert!(is_system_protected(Path::new("/System/Library")).unwrap());
        assert!(is_system_protected(Path::new("/Library")).unwrap());
        assert!(is_system_protected(Path::new("/private/var")).unwrap());
        assert!(is_volume_root(Path::new("/Volumes/External")).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn unix_volume_roots_follow_device_boundaries() {
        let mount = Path::new("/mnt/external");
        assert!(unix_volume_root_with(mount, |path| {
            if path == mount {
                Ok(2)
            } else if path == Path::new("/mnt") {
                Ok(1)
            } else {
                unreachable!()
            }
        })
        .unwrap());
        assert!(!unix_volume_root_with(mount, |_| Ok(1)).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn unix_volume_root_detection_propagates_metadata_errors() {
        assert!(unix_volume_root_with(Path::new("/mnt/external"), |_| {
            Err("metadata unavailable".into())
        })
        .is_err());
    }

    #[test]
    fn linux_mountinfo_detects_same_device_mount_points() {
        let mountinfo = "36 29 0:42 /source /mnt/bind rw - ext4 /dev/root rw\n";
        assert!(linux_mountinfo_has_mount_point(mountinfo, Path::new("/mnt/bind")).unwrap());
    }

    #[test]
    fn linux_mountinfo_does_not_match_non_mount_paths() {
        let mountinfo = "36 29 0:42 /source /mnt/bind rw - ext4 /dev/root rw\n";
        assert!(!linux_mountinfo_has_mount_point(mountinfo, Path::new("/mnt/plain")).unwrap());
    }

    #[test]
    fn linux_mountinfo_unescapes_space_and_backslash() {
        let mountinfo = concat!(
            r"36 29 0:42 / /mnt/My\040Drive rw - ext4 /dev/root rw",
            "\n",
            r"37 29 0:42 / /mnt/back\134slash rw - ext4 /dev/root rw",
            "\n",
        );
        assert!(linux_mountinfo_has_mount_point(mountinfo, Path::new("/mnt/My Drive")).unwrap());
        assert!(linux_mountinfo_has_mount_point(mountinfo, Path::new(r"/mnt/back\slash")).unwrap());
    }

    #[test]
    fn linux_mountinfo_rejects_malformed_lines() {
        assert!(
            linux_mountinfo_has_mount_point("not a mountinfo line\n", Path::new("/mnt/bind"))
                .is_err()
        );
    }

    #[test]
    fn linux_mountinfo_rejects_malformed_escapes() {
        let mountinfo = r"36 29 0:42 / /mnt/bad\04x rw - ext4 /dev/root rw";
        assert!(linux_mountinfo_has_mount_point(mountinfo, Path::new("/mnt/bad")).is_err());
    }

    #[test]
    fn windows_system_roots_fail_closed_without_system_root() {
        let roots = windows_system_protected_roots_with(None, |_| Ok(PathBuf::from("unused")));
        assert!(roots.is_err());
    }

    #[test]
    fn windows_system_roots_fail_closed_when_canonicalize_fails() {
        let roots = windows_system_protected_roots_with(Some(PathBuf::from(r"C:\Windows")), |_| {
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "missing"))
        });
        assert!(roots.is_err());
    }

    #[test]
    fn changed_nonempty_and_outside_files_are_refused() {
        let dirs = TestDirs::new();
        let mut safety = dirs.safety();
        let changed = safety.create_owned_seat_file().unwrap();
        fs::write(&changed, "user data").unwrap();
        assert!(safety.trash_owned_with(&changed, |_| Ok(())).is_err());

        let outside = dirs.root.join("outside.tmp");
        fs::write(&outside, []).unwrap();
        assert!(safety.trash_owned_with(&outside, |_| Ok(())).is_err());
    }

    #[test]
    fn replacing_an_owned_file_is_refused_even_when_the_replacement_is_empty() {
        let dirs = TestDirs::new();
        let mut safety = dirs.safety();
        let owned = safety.create_owned_seat_file().unwrap();
        fs::remove_file(&owned).unwrap();
        fs::write(&owned, []).unwrap();
        assert!(safety.trash_owned_with(&owned, |_| Ok(())).is_err());
    }

    #[test]
    fn malformed_manifest_fails_closed_without_crashing() {
        let dirs = TestDirs::new();
        fs::write(dirs.data.join("owned-seat-files.json"), "{").unwrap();
        let safety = dirs.safety();
        assert!(safety.owned.is_empty());
    }

    #[test]
    fn application_and_shortcut_names_are_not_seat_candidates() {
        for name in [
            "Tool.app",
            "setup.exe",
            "link.lnk",
            "launcher.desktop",
            "disk.dmg",
        ] {
            assert!(is_application_name(name), "{name}");
        }
        assert!(!is_application_name("notes.txt"));
        assert!(!is_application_name("Projects"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_refused() {
        let dirs = TestDirs::new();
        let safety = dirs.safety();
        let target = dirs.desktop.join("target.tmp");
        let link = dirs.desktop.join("link.tmp");
        fs::write(&target, []).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(safety.validate_owned(&link).is_err());
        assert!(safety.validate_user_food(&link).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_parent_components_are_refused() {
        let dirs = TestDirs::new();
        let safety = dirs.safety();
        let documents = dirs.home.join("Documents");
        let route = dirs.desktop.join("route");
        fs::create_dir(&documents).unwrap();
        fs::write(documents.join("food.txt"), "food").unwrap();
        std::os::unix::fs::symlink(&documents, &route).unwrap();
        assert!(safety.validate_user_food(&route.join("food.txt")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_folder_with_trailing_separator_is_refused() {
        let dirs = TestDirs::new();
        let safety = dirs.safety();
        let folder = dirs.home.join("Documents");
        let link = dirs.desktop.join("link");
        fs::create_dir(&folder).unwrap();
        std::os::unix::fs::symlink(&folder, &link).unwrap();
        let path = PathBuf::from(format!("{}/", link.display()));
        assert!(safety.validate_user_food(&path).is_err());
    }

    #[test]
    fn relative_user_food_paths_are_rejected() {
        let dirs = TestDirs::new();
        let file = dirs.desktop.join("relative-food.txt");
        fs::write(&file, "food").unwrap();
        let relative = file.strip_prefix(std::env::current_dir().unwrap()).unwrap();
        assert!(dirs.safety().validate_user_food(relative).is_err());
    }

    #[test]
    fn missing_and_repeated_cleanup_are_harmless() {
        let dirs = TestDirs::new();
        let mut safety = dirs.safety();
        let owned = safety.create_owned_seat_file().unwrap();
        fs::remove_file(owned).unwrap();
        assert!(safety.cleanup_owned_with(|_| Ok(())).is_ok());
        assert!(safety.cleanup_owned_with(|_| Ok(())).is_ok());
    }

    #[test]
    fn trash_operation_runs_on_a_dedicated_thread() {
        let caller = std::thread::current().id();

        run_trash_operation(move || {
            if std::thread::current().id() == caller {
                Err("回收站操作仍在调用线程执行".into())
            } else {
                Ok(())
            }
        })
        .unwrap();
    }

    #[test]
    fn trash_operation_propagates_worker_errors() {
        assert_eq!(
            run_trash_operation(|| Err::<(), _>("预期错误".into())),
            Err("预期错误".into())
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_recycle_adapter_moves_a_file_to_the_recycle_bin() {
        let directory = tempfile::tempdir().unwrap();
        let name = format!(
            "uno-recycle-adapter-{}-{}.txt",
            std::process::id(),
            NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed)
        );
        let path = directory.path().join(&name);
        fs::write(&path, "UNO recycle adapter test").unwrap();

        recycle_path(&path).unwrap();
        assert!(!path.exists());

        let item = trash::os_limited::list()
            .unwrap()
            .into_iter()
            .find(|item| item.name == std::ffi::OsStr::new(&name))
            .expect("generated test file was not found in the Recycle Bin");
        trash::os_limited::restore_all([item]).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn food_errors_identify_the_failing_stage() {
        assert_eq!(
            food_stage_error("确认-文件身份", "函数不正确"),
            "[确认-文件身份] 函数不正确"
        );
    }

    #[test]
    fn last_food_error_is_saved_for_diagnosis() {
        let directory = tempfile::tempdir().unwrap();
        record_last_food_error(directory.path(), "[确认-路径复核] 函数不正确").unwrap();

        assert_eq!(
            fs::read_to_string(directory.path().join("last-food-error.txt")).unwrap(),
            "[确认-路径复核] 函数不正确"
        );
    }

}
