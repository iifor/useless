use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize};

const WINDOW_MARGIN: i32 = 16;

pub fn position_for_slot(
    slot: usize,
    work_area: PhysicalRect<i32, u32>,
    window: PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let work_width = i32::try_from(work_area.size.width).unwrap_or(i32::MAX);
    let work_height = i32::try_from(work_area.size.height).unwrap_or(i32::MAX);
    let window_width = i32::try_from(window.width).unwrap_or(i32::MAX);
    let window_height = i32::try_from(window.height).unwrap_or(i32::MAX);
    let usable_width = work_width.saturating_sub(WINDOW_MARGIN * 2).max(window_width);
    let usable_height = work_height.saturating_sub(WINDOW_MARGIN * 2).max(window_height);
    let columns = (usable_width / window_width.max(1)).max(1) as usize;
    let rows = (usable_height / window_height.max(1)).max(1) as usize;
    let index = slot % columns.saturating_mul(rows).max(1);
    let column = index % columns;
    let row = index / columns;
    let minimum_x = work_area.position.x.saturating_add(WINDOW_MARGIN);
    let minimum_y = work_area.position.y.saturating_add(WINDOW_MARGIN);
    let maximum_x = work_area
        .position
        .x
        .saturating_add(work_width)
        .saturating_sub(window_width)
        .saturating_sub(WINDOW_MARGIN)
        .max(work_area.position.x);
    let maximum_y = work_area
        .position
        .y
        .saturating_add(work_height)
        .saturating_sub(window_height)
        .saturating_sub(WINDOW_MARGIN)
        .max(work_area.position.y);
    let step_x = if columns > 1 {
        (maximum_x - minimum_x).max(0) / (columns - 1) as i32
    } else {
        0
    };
    let step_y = if rows > 1 {
        (maximum_y - minimum_y).max(0) / (rows - 1) as i32
    } else {
        0
    };

    PhysicalPosition::new(
        minimum_x
            .saturating_add(step_x.saturating_mul(column as i32))
            .clamp(work_area.position.x, maximum_x),
        minimum_y
            .saturating_add(step_y.saturating_mul(row as i32))
            .clamp(work_area.position.y, maximum_y),
    )
}

#[cfg(windows)]
pub fn claim_instance_slot(identifier: &str) -> usize {
    use std::{os::windows::ffi::OsStrExt, sync::OnceLock};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, SetLastError, ERROR_ALREADY_EXISTS},
        System::Threading::CreateMutexW,
    };

    static SLOT: OnceLock<usize> = OnceLock::new();
    *SLOT.get_or_init(|| {
        let prefix = mutex_prefix(identifier);
        for slot in 0..32 {
            let name = format!(r"{prefix}-{slot}");
            let wide_name: Vec<u16> = std::ffi::OsStr::new(&name)
                .encode_wide()
                .chain(Some(0))
                .collect();
            unsafe { SetLastError(0) };
            let handle = unsafe { CreateMutexW(std::ptr::null(), 0, wide_name.as_ptr()) };
            if handle.is_null() {
                continue;
            }
            if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
                unsafe { CloseHandle(handle) };
                continue;
            }

            // The process intentionally owns this single handle until Windows closes it at exit.
            return slot;
        }
        std::process::id() as usize % 32
    })
}

#[cfg(not(windows))]
pub fn claim_instance_slot(_identifier: &str) -> usize {
    std::process::id() as usize % 32
}

#[cfg(any(windows, test))]
pub fn mutex_prefix(identifier: &str) -> String {
    let safe: String = identifier
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect();
    format!(r"Local\Pet-{safe}-Slot")
}

pub fn position_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到桌宠主窗口".to_owned())?;
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(window.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or_else(|| "找不到可用显示器".to_owned())?;
    let position = position_for_slot(
        claim_instance_slot(&app.config().identifier),
        *monitor.work_area(),
        window.outer_size().map_err(|error| error.to_string())?,
    );
    window.set_position(position).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work_area() -> PhysicalRect<i32, u32> {
        PhysicalRect {
            position: PhysicalPosition::new(0, 0),
            size: PhysicalSize::new(1920, 1040),
        }
    }

    #[test]
    fn instance_positions_are_distinct_and_visible() {
        let window = PhysicalSize::new(280, 320);
        let positions = [0, 1, 2].map(|slot| position_for_slot(slot, work_area(), window));

        assert_ne!(positions[0], positions[1]);
        assert_ne!(positions[1], positions[2]);
        for position in positions {
            assert!(position.x >= 0);
            assert!(position.y >= 0);
            assert!(position.x + window.width as i32 <= 1920);
            assert!(position.y + window.height as i32 <= 1040);
        }
    }

    #[test]
    fn instance_positions_wrap_without_leaving_the_work_area() {
        let window = PhysicalSize::new(280, 320);
        let position = position_for_slot(10_000, work_area(), window);

        assert!(position.x >= 0);
        assert!(position.y >= 0);
        assert!(position.x + window.width as i32 <= 1920);
        assert!(position.y + window.height as i32 <= 1040);
    }

    #[test]
    fn mutex_prefixes_are_deterministic_and_distinct_per_bundle() {
        assert_eq!(mutex_prefix("com.example.pet-one"), r"Local\Pet-com-example-pet-one-Slot");
        assert_ne!(
            mutex_prefix("com.example.pet-one"),
            mutex_prefix("com.example.pet-two"),
        );
    }
}
