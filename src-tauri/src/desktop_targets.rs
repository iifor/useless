use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

use crate::food_safety::{is_application_name, is_os_hidden};

#[derive(Clone, Copy, Debug, PartialEq)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn contains(self, point: Point) -> bool {
        point.x >= self.x
            && point.x <= self.x + self.width
            && point.y >= self.y
            && point.y <= self.y + self.height
    }

    fn intersects(self, other: Self) -> bool {
        self.x < other.x + other.width
            && self.x + self.width > other.x
            && self.y < other.y + other.height
            && self.y + self.height > other.y
    }
}

#[derive(Clone, Debug)]
struct FinderItem {
    path: String,
    bounds: Rect,
}

#[derive(Clone, Debug)]
struct RawWindow {
    id: u64,
    pid: u32,
    name: String,
    bounds: Rect,
    visible: bool,
    minimized: bool,
    tool: bool,
    focused: bool,
}

impl RawWindow {
    #[cfg(test)]
    fn normal(id: u64, pid: u32, bounds: Rect) -> Self {
        Self {
            id,
            pid,
            name: "Window".into(),
            bounds,
            visible: true,
            minimized: false,
            tool: false,
            focused: false,
        }
    }
}

#[derive(Clone, Debug)]
struct WindowTarget {
    native_id: String,
    name: String,
    anchor: Point,
    focused: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatAnchor {
    x: f64,
    y: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSeatTarget {
    id: String,
    name: String,
    kind: String,
    path: Option<String>,
    seat_anchor: Option<SeatAnchor>,
    native_window_id: Option<String>,
    focused: bool,
    app_owned: bool,
    virtual_marker: bool,
}

impl DesktopSeatTarget {
    pub(crate) fn owned(path: PathBuf) -> Self {
        Self {
            id: path.to_string_lossy().into_owned(),
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            kind: "owned-temp".into(),
            path: Some(path.to_string_lossy().into_owned()),
            seat_anchor: None,
            native_window_id: None,
            focused: false,
            app_owned: true,
            virtual_marker: true,
        }
    }

    fn window(target: WindowTarget) -> Self {
        Self {
            id: format!("window:{}", target.native_id),
            name: target.name,
            kind: "window".into(),
            path: None,
            seat_anchor: Some(target.anchor.into()),
            native_window_id: Some(target.native_id),
            focused: target.focused,
            app_owned: false,
            virtual_marker: false,
        }
    }
}

impl From<Point> for SeatAnchor {
    fn from(point: Point) -> Self {
        Self {
            x: point.x,
            y: point.y,
        }
    }
}

struct TargetContext {
    work_area: Rect,
    pet_height: f64,
    scale_factor: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum SeatSearchMode {
    Auto,
    FocusedWindow,
    DesktopIcon,
}

fn target_context(app: &AppHandle) -> Result<TargetContext, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "宠物主窗口不存在".to_owned())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法确定宠物当前显示器".to_owned())?;
    let pet_size = window.outer_size().map_err(|error| error.to_string())?;
    Ok(TargetContext {
        work_area: Rect::new(
            f64::from(monitor.work_area().position.x),
            f64::from(monitor.work_area().position.y),
            f64::from(monitor.work_area().size.width),
            f64::from(monitor.work_area().size.height),
        ),
        pet_height: f64::from(pet_size.height),
        scale_factor: monitor.scale_factor(),
    })
}

#[tauri::command]
pub async fn find_seat_targets(
    app: AppHandle,
    mode: SeatSearchMode,
) -> Result<Vec<DesktopSeatTarget>, String> {
    let context = target_context(&app)?;
    let windows = platform_windows(&context)?;
    let visible_windows = visible_window_targets(
        windows.clone(),
        context.work_area,
        std::process::id(),
        context.pet_height,
    );
    if let Some(target) = window_target_for_mode(&visible_windows, mode) {
        return Ok(vec![DesktopSeatTarget::window(target)]);
    }
    if mode == SeatSearchMode::FocusedWindow {
        return Ok(Vec::new());
    }
    let occluders: Vec<_> = windows
        .iter()
        .filter(|window| window.visible && !window.minimized && !window.tool)
        .map(|window| window.bounds)
        .collect();
    match platform_desktop_items(&app, &context).await {
        Ok(items) => Ok(desktop_item_targets(items, context.work_area, &occluders)),
        Err(error) => {
            eprintln!("桌面图标坐标不可用，将使用自建座位: {error}");
            Ok(Vec::new())
        }
    }
}

#[tauri::command]
pub fn refresh_window_seat(
    app: AppHandle,
    native_window_id: String,
) -> Result<Option<DesktopSeatTarget>, String> {
    let context = target_context(&app)?;
    let target = visible_window_targets(
        platform_windows(&context)?,
        context.work_area,
        std::process::id(),
        context.pet_height,
    )
    .into_iter()
    .find(|target| target.native_id == native_window_id)
    .map(DesktopSeatTarget::window);
    Ok(target)
}

fn desktop_item_targets(
    items: Vec<FinderItem>,
    work_area: Rect,
    occluders: &[Rect],
) -> Vec<DesktopSeatTarget> {
    items
        .into_iter()
        .filter(|item| {
            item.bounds.intersects(work_area) && !icon_is_occluded(item.bounds, occluders)
        })
        .filter_map(|item| {
            let path = PathBuf::from(&item.path);
            let name = path.file_name()?.to_string_lossy().into_owned();
            if name.starts_with('.') || is_application_name(&name) {
                return None;
            }
            let metadata = fs::symlink_metadata(&path).ok()?;
            if metadata.file_type().is_symlink()
                || (!metadata.is_file() && !metadata.is_dir())
                || is_os_hidden(&metadata)
            {
                return None;
            }
            Some(DesktopSeatTarget {
                id: path.to_string_lossy().into_owned(),
                name,
                kind: if metadata.is_dir() { "folder" } else { "file" }.into(),
                path: Some(path.to_string_lossy().into_owned()),
                seat_anchor: Some(SeatAnchor {
                    x: item.bounds.x + item.bounds.width / 2.0,
                    y: item.bounds.y,
                }),
                native_window_id: None,
                focused: false,
                app_owned: false,
                virtual_marker: false,
            })
        })
        .collect()
}

fn parse_finder_items(value: &str) -> Vec<FinderItem> {
    value
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let path = fields.next()?.to_owned();
            let x = fields.next()?.parse().ok()?;
            let y = fields.next()?.parse().ok()?;
            let width = fields.next()?.parse().ok()?;
            let height = fields.next()?.parse().ok()?;
            (fields.next().is_none() && !path.is_empty()).then(|| FinderItem {
                path,
                bounds: Rect::new(x, y, width, height),
            })
        })
        .collect()
}

fn visible_window_targets(
    windows: Vec<RawWindow>,
    work_area: Rect,
    own_pid: u32,
    pet_height: f64,
) -> Vec<WindowTarget> {
    windows
        .into_iter()
        .filter(|window| {
            window.visible
                && !window.minimized
                && !window.tool
                && window.pid != own_pid
                && window.bounds.width >= 100.0
                && window.bounds.height >= 60.0
                && window.bounds.intersects(work_area)
                && window.bounds.y - work_area.y >= pet_height
        })
        .map(|window| WindowTarget {
            native_id: window.id.to_string(),
            name: window.name,
            anchor: Point {
                x: window.bounds.x + window.bounds.width / 2.0,
                y: window.bounds.y,
            },
            focused: window.focused,
        })
        .collect()
}

fn focused_window_target(windows: &[WindowTarget]) -> Option<WindowTarget> {
    windows.iter().find(|window| window.focused).cloned()
}

fn window_target_for_mode(
    windows: &[WindowTarget],
    mode: SeatSearchMode,
) -> Option<WindowTarget> {
    match mode {
        SeatSearchMode::Auto => focused_window_target(windows),
        SeatSearchMode::FocusedWindow => focused_window_target(windows)
            .or_else(|| windows.first().cloned()),
        SeatSearchMode::DesktopIcon => None,
    }
}

fn icon_is_occluded(icon: Rect, windows: &[Rect]) -> bool {
    let center = Point {
        x: icon.x + icon.width / 2.0,
        y: icon.y + icon.height / 2.0,
    };
    windows.iter().any(|window| window.contains(center))
}

#[cfg(target_os = "macos")]
fn logical_to_physical(rect: Rect, context: &TargetContext) -> Rect {
    let scale = context.scale_factor;
    let logical_origin_x = context.work_area.x / scale;
    let logical_origin_y = context.work_area.y / scale;
    Rect::new(
        context.work_area.x + (rect.x - logical_origin_x) * scale,
        context.work_area.y + (rect.y - logical_origin_y) * scale,
        rect.width * scale,
        rect.height * scale,
    )
}

#[cfg(target_os = "macos")]
fn platform_windows(context: &TargetContext) -> Result<Vec<RawWindow>, String> {
    use core_foundation::{
        base::{CFType, TCFType},
        dictionary::CFDictionary,
        number::CFNumber,
        string::{CFString, CFStringRef},
    };
    use core_graphics::{
        geometry::CGRect,
        window::{
            copy_window_info, kCGNullWindowID, kCGWindowAlpha, kCGWindowBounds, kCGWindowLayer,
            kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowName,
            kCGWindowNumber, kCGWindowOwnerName, kCGWindowOwnerPID,
        },
    };
    use objc2_app_kit::NSWorkspace;

    fn value(dictionary: &CFDictionary, key: CFStringRef) -> Option<CFType> {
        let raw = *dictionary.find(key.cast())?;
        Some(unsafe { CFType::wrap_under_get_rule(raw.cast()) })
    }

    fn number(dictionary: &CFDictionary, key: CFStringRef) -> Option<f64> {
        value(dictionary, key)?.downcast::<CFNumber>()?.to_f64()
    }

    fn string(dictionary: &CFDictionary, key: CFStringRef) -> Option<String> {
        value(dictionary, key)
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
    }

    fn bounds(dictionary: &CFDictionary, key: CFStringRef) -> Option<Rect> {
        let dictionary = value(dictionary, key)?.downcast::<CFDictionary>()?;
        let rect = CGRect::from_dict_representation(&dictionary)?;
        Some(Rect::new(
            rect.origin.x,
            rect.origin.y,
            rect.size.width,
            rect.size.height,
        ))
    }

    let focused_pid = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .and_then(|application| u32::try_from(application.processIdentifier()).ok());
    let list = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )
    .ok_or_else(|| "CoreGraphics 未返回可视窗口".to_owned())?;
    let mut windows = Vec::new();
    for raw in list.get_all_values() {
        let dictionary = unsafe { CFDictionary::wrap_under_get_rule(raw.cast()) };
        let (id, pid, layer, alpha, logical_bounds) = unsafe {
            (
                number(&dictionary, kCGWindowNumber),
                number(&dictionary, kCGWindowOwnerPID),
                number(&dictionary, kCGWindowLayer),
                number(&dictionary, kCGWindowAlpha),
                bounds(&dictionary, kCGWindowBounds),
            )
        };
        let (Some(id), Some(pid), Some(layer), Some(alpha), Some(logical_bounds)) =
            (id, pid, layer, alpha, logical_bounds)
        else {
            continue;
        };
        let logical_work_area = Rect::new(
            context.work_area.x / context.scale_factor,
            context.work_area.y / context.scale_factor,
            context.work_area.width / context.scale_factor,
            context.work_area.height / context.scale_factor,
        );
        if !logical_bounds.intersects(logical_work_area) {
            continue;
        }
        let name = unsafe {
            string(&dictionary, kCGWindowName).or_else(|| string(&dictionary, kCGWindowOwnerName))
        }
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "窗口".into());
        windows.push(RawWindow {
            id: id as u64,
            pid: pid as u32,
            name,
            bounds: logical_to_physical(logical_bounds, context),
            visible: true,
            minimized: false,
            tool: layer != 0.0 || alpha <= 0.01,
            focused: focused_pid == Some(pid as u32),
        });
    }
    Ok(windows)
}

#[cfg(target_os = "macos")]
async fn platform_desktop_items(
    app: &AppHandle,
    context: &TargetContext,
) -> Result<Vec<FinderItem>, String> {
    use osakit::{Language, Script, Value};
    use std::sync::mpsc::sync_channel;

    const SCRIPT: &str = r#"
tell application "Finder"
  set outputText to ""
  set iconSizeValue to icon size of icon view options of desktop
  repeat with desktopItem in every item of desktop
    try
      set itemPath to POSIX path of (desktopItem as alias)
      set itemPosition to desktop position of desktopItem
      set outputText to outputText & itemPath & tab & (item 1 of itemPosition as text) & tab & (item 2 of itemPosition as text) & tab & (iconSizeValue as text) & tab & (iconSizeValue as text) & linefeed
    end try
  end repeat
  return outputText
end tell
"#;

    let (sender, receiver) = sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            let mut script = Script::new_from_source(Language::AppleScript, SCRIPT);
            script.compile().map_err(|error| error.to_string())?;
            match script.execute().map_err(|error| error.to_string())? {
                Value::String(value) => Ok(value),
                _ => Err("Finder 返回了无法识别的桌面坐标".to_owned()),
            }
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;

    let output = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())??;
    Ok(parse_finder_items(&output)
        .into_iter()
        .map(|mut item| {
            item.bounds = logical_to_physical(item.bounds, context);
            item
        })
        .collect())
}

#[cfg(windows)]
fn platform_windows(_context: &TargetContext) -> Result<Vec<RawWindow>, String> {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::{
        core::BOOL,
        Win32::{
            Foundation::{HWND, LPARAM, RECT, TRUE},
            Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            UI::WindowsAndMessaging::{
                EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
                GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
                IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
            },
        },
    };

    unsafe fn wide_text(window: HWND, class_name: bool) -> String {
        let length = if class_name {
            256
        } else {
            GetWindowTextLengthW(window).max(0) as usize + 1
        };
        let mut buffer = vec![0u16; length.max(2)];
        let written = if class_name {
            GetClassNameW(window, buffer.as_mut_ptr(), buffer.len() as i32)
        } else {
            GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32)
        };
        String::from_utf16_lossy(&buffer[..written.max(0) as usize])
    }

    unsafe extern "system" fn collect(window: HWND, parameter: LPARAM) -> BOOL {
        let windows = &mut *(parameter as *mut Vec<RawWindow>);
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        let class_name = wide_text(window, true);
        let mut bounds: RECT = std::mem::zeroed();
        if DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut bounds as *mut RECT).cast::<c_void>(),
            size_of::<RECT>() as u32,
        ) != 0
            && GetWindowRect(window, &mut bounds) == 0
        {
            return TRUE;
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            window,
            DWMWA_CLOAKED as u32,
            (&mut cloaked as *mut u32).cast::<c_void>(),
            size_of::<u32>() as u32,
        );
        let excluded_container = matches!(
            class_name.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        );
        windows.push(RawWindow {
            id: window as usize as u64,
            pid,
            name: wide_text(window, false),
            bounds: Rect::new(
                f64::from(bounds.left),
                f64::from(bounds.top),
                f64::from(bounds.right - bounds.left),
                f64::from(bounds.bottom - bounds.top),
            ),
            visible: IsWindowVisible(window) != 0 && cloaked == 0,
            minimized: IsIconic(window) != 0,
            tool: excluded_container
                || GetWindowLongW(window, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW != 0,
            focused: GetForegroundWindow() == window,
        });
        TRUE
    }

    let mut windows = Vec::new();
    let result = unsafe {
        EnumWindows(
            Some(collect),
            (&mut windows as *mut Vec<RawWindow>) as LPARAM,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(windows)
}

#[cfg(windows)]
async fn platform_desktop_items(
    app: &AppHandle,
    _context: &TargetContext,
) -> Result<Vec<FinderItem>, String> {
    use std::{collections::HashMap, os::windows::process::CommandExt, process::Command};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SCRIPT: &str = r#"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
$explorerIds = @((Get-Process explorer -ErrorAction SilentlyContinue).Id)
$condition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::ListItem)
$items = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants, $condition)
foreach ($item in $items) {
  try {
    if ($explorerIds -notcontains $item.Current.ProcessId -or $item.Current.IsOffscreen) { continue }
    $rect = $item.Current.BoundingRectangle
    if ($rect.Width -le 0 -or $rect.Height -le 0) { continue }
    $name = ($item.Current.Name -replace "`t|`r|`n", " ")
    "$name`t$([math]::Round($rect.Left))`t$([math]::Round($rect.Top))`t$([math]::Round($rect.Width))`t$([math]::Round($rect.Height))"
  } catch {}
}
"#;

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|error| error.to_string())?;
    let mut by_name: HashMap<String, Vec<PathBuf>> = HashMap::new();
    for entry in fs::read_dir(desktop)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        by_name.entry(name).or_default().push(path.clone());
        if let Some(stem) = path.file_stem() {
            by_name
                .entry(stem.to_string_lossy().to_lowercase())
                .or_default()
                .push(path);
        }
    }
    Ok(parse_finder_items(&String::from_utf8_lossy(&output.stdout))
        .into_iter()
        .filter_map(|mut item| {
            let paths = by_name.get(&item.path.to_lowercase())?;
            if paths.len() != 1 {
                return None;
            }
            item.path = paths[0].to_string_lossy().into_owned();
            Some(item)
        })
        .collect())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_windows(_context: &TargetContext) -> Result<Vec<RawWindow>, String> {
    Ok(Vec::new())
}

#[cfg(not(any(target_os = "macos", windows)))]
async fn platform_desktop_items(
    _app: &AppHandle,
    _context: &TargetContext,
) -> Result<Vec<FinderItem>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_seat_search_modes_and_rejects_unknown_modes() {
        assert_eq!(
            serde_json::from_str::<SeatSearchMode>(r#""auto""#).unwrap(),
            SeatSearchMode::Auto
        );
        assert_eq!(
            serde_json::from_str::<SeatSearchMode>(r#""focused-window""#).unwrap(),
            SeatSearchMode::FocusedWindow
        );
        assert_eq!(
            serde_json::from_str::<SeatSearchMode>(r#""desktop-icon""#).unwrap(),
            SeatSearchMode::DesktopIcon
        );
        assert!(serde_json::from_str::<SeatSearchMode>(r#""unknown""#).is_err());
    }

    #[test]
    fn parses_finder_positions_and_rejects_malformed_rows() {
        let items = parse_finder_items("/Users/me/Desktop/a.txt\t100\t200\t64\t64\ninvalid");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].path, "/Users/me/Desktop/a.txt");
        assert_eq!(items[0].bounds, Rect::new(100.0, 200.0, 64.0, 64.0));
    }

    #[test]
    fn filters_self_hidden_minimized_tool_and_no_clearance_windows() {
        let work_area = Rect::new(0.0, 24.0, 1440.0, 876.0);
        let visible = RawWindow::normal(7, 200, Rect::new(300.0, 300.0, 600.0, 400.0));
        let candidates = vec![
            visible.clone(),
            RawWindow {
                pid: 100,
                ..visible.clone()
            },
            RawWindow {
                visible: false,
                ..visible.clone()
            },
            RawWindow {
                minimized: true,
                ..visible.clone()
            },
            RawWindow {
                tool: true,
                ..visible.clone()
            },
            RawWindow {
                bounds: Rect::new(300.0, 100.0, 600.0, 400.0),
                ..visible
            },
        ];

        let targets = visible_window_targets(candidates, work_area, 100, 200.0);
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].native_id, "7");
        assert_eq!(targets[0].anchor, Point { x: 600.0, y: 300.0 });
    }

    #[test]
    fn selects_only_the_valid_focused_window() {
        let work_area = Rect::new(0.0, 24.0, 1440.0, 876.0);
        let bounds = Rect::new(300.0, 300.0, 600.0, 400.0);
        let focused = RawWindow {
            focused: true,
            ..RawWindow::normal(7, 200, bounds)
        };
        let background = RawWindow::normal(8, 201, bounds);

        let targets = visible_window_targets(vec![background, focused], work_area, 100, 200.0);

        assert_eq!(focused_window_target(&targets).unwrap().native_id, "7");
    }

    #[test]
    fn rejects_a_focused_uno_window_instead_of_using_a_background_window() {
        let work_area = Rect::new(0.0, 24.0, 1440.0, 876.0);
        let bounds = Rect::new(300.0, 300.0, 600.0, 400.0);
        let own = RawWindow {
            focused: true,
            ..RawWindow::normal(7, 100, bounds)
        };
        let background = RawWindow::normal(8, 201, bounds);

        let targets = visible_window_targets(vec![own, background], work_area, 100, 200.0);

        assert!(focused_window_target(&targets).is_none());
    }

    #[test]
    fn manual_current_window_uses_the_topmost_external_window_after_the_pet_takes_focus() {
        let windows = vec![WindowTarget {
            native_id: "8".into(),
            name: "Work".into(),
            anchor: Point { x: 600.0, y: 300.0 },
            focused: false,
        }];

        assert_eq!(
            window_target_for_mode(&windows, SeatSearchMode::FocusedWindow)
                .unwrap()
                .native_id,
            "8"
        );
        assert!(window_target_for_mode(&windows, SeatSearchMode::Auto).is_none());
    }

    #[test]
    fn excludes_desktop_icons_occluded_by_a_normal_window() {
        let icon = Rect::new(100.0, 100.0, 64.0, 64.0);
        assert!(icon_is_occluded(
            icon,
            &[Rect::new(80.0, 80.0, 200.0, 200.0)]
        ));
        assert!(!icon_is_occluded(
            icon,
            &[Rect::new(300.0, 300.0, 200.0, 200.0)]
        ));
    }
}
