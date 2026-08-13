use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
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
    desktop: PathBuf,
    manifest: PathBuf,
    owned: Vec<OwnedSeat>,
}

impl FoodSafety {
    fn from_app(app: &AppHandle) -> Result<Self, String> {
        let desktop = app
            .path()
            .desktop_dir()
            .map_err(|error| error.to_string())?;
        let data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(&data).map_err(|error| error.to_string())?;
        Self::new(desktop, data.join("owned-seat-files.json"))
    }

    fn new(desktop: PathBuf, manifest: PathBuf) -> Result<Self, String> {
        let owned = match fs::read(&manifest) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                eprintln!("忽略损坏的宠物座位所有权清单（安全保留原文件）: {error}");
                Vec::new()
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self {
            desktop,
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
                        identity: file_identity(&metadata),
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
            || file_identity(&metadata) != record.identity
            || permission_fingerprint(&metadata) != record.permissions
            || metadata.permissions().readonly() != record.readonly
        {
            return Err("座位文件已被用户修改".into());
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
fn file_identity(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!("{}:{}", metadata.dev(), metadata.ino())
}

#[cfg(windows)]
fn file_identity(metadata: &fs::Metadata) -> String {
    use std::os::windows::fs::MetadataExt;
    format!("{}:{}", metadata.creation_time(), metadata.file_size())
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

#[tauri::command]
pub fn trash_owned_seat_file(app: AppHandle, path: String) -> Result<(), String> {
    FoodSafety::from_app(&app)?.trash_owned_with(Path::new(&path), |target| {
        trash::delete(target).map_err(|error| error.to_string())
    })
}

pub fn cleanup_owned_seat_files(app: &AppHandle) -> Result<usize, String> {
    FoodSafety::from_app(app)?
        .cleanup_owned_with(|target| trash::delete(target).map_err(|error| error.to_string()))
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
        desktop: PathBuf,
        data: PathBuf,
    }

    impl TestDirs {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "black-shirt-pet-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
                    + u128::from(NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed)),
            ));
            let desktop = root.join("Desktop");
            let data = root.join("Data");
            fs::create_dir_all(&desktop).unwrap();
            fs::create_dir_all(&data).unwrap();
            Self {
                root,
                desktop,
                data,
            }
        }

        fn safety(&self) -> FoodSafety {
            FoodSafety::new(self.desktop.clone(), self.data.join("owned-seats.json")).unwrap()
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
        fs::write(dirs.data.join("owned-seats.json"), "{").unwrap();
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
}
