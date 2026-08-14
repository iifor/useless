use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum UpdatePhase {
    #[default]
    Idle,
    Checking,
    Ready,
    Installing,
}

#[derive(Default)]
struct UpdateGate(Mutex<UpdatePhase>);

impl UpdateGate {
    fn with_phase<T>(&self, update: impl FnOnce(&mut UpdatePhase) -> T) -> T {
        let mut phase = self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut phase)
    }

    fn begin_check(&self) -> bool {
        self.with_phase(|phase| {
            if *phase != UpdatePhase::Idle {
                return false;
            }
            *phase = UpdatePhase::Checking;
            true
        })
    }

    fn mark_ready(&self) -> bool {
        self.with_phase(|phase| {
            if *phase != UpdatePhase::Checking {
                return false;
            }
            *phase = UpdatePhase::Ready;
            true
        })
    }

    fn begin_install(&self) -> bool {
        self.with_phase(|phase| {
            if *phase != UpdatePhase::Ready {
                return false;
            }
            *phase = UpdatePhase::Installing;
            true
        })
    }

    fn restore_ready(&self) -> bool {
        self.with_phase(|phase| {
            if *phase != UpdatePhase::Installing {
                return false;
            }
            *phase = UpdatePhase::Ready;
            true
        })
    }

    fn reset(&self) {
        self.with_phase(|phase| *phase = UpdatePhase::Idle);
    }

    #[cfg(test)]
    fn phase(&self) -> UpdatePhase {
        self.with_phase(|phase| *phase)
    }
}

#[cfg(any(windows, test))]
fn idle_seconds_from_ticks(current: u32, last_input: u32) -> u64 {
    u64::from(current.wrapping_sub(last_input) / 1_000)
}

fn idle_seconds_from_float(seconds: f64) -> u64 {
    if seconds.is_finite() && seconds >= 0.0 {
        seconds.floor() as u64
    } else {
        0
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    current_version: String,
    version: String,
}

struct DownloadedUpdate {
    update: Update,
    bytes: Vec<u8>,
    metadata: UpdateMetadata,
}

#[derive(Default)]
pub struct UpdateManager {
    gate: UpdateGate,
    pending: Mutex<Option<DownloadedUpdate>>,
}

impl UpdateManager {
    fn metadata(&self) -> Option<UpdateMetadata> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|pending| pending.metadata.clone())
    }
}

#[tauri::command]
pub async fn prepare_update(
    app: AppHandle,
    manager: State<'_, UpdateManager>,
) -> Result<Option<UpdateMetadata>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    if !manager.gate.begin_check() {
        return Ok(manager.metadata());
    }

    let result = async {
        let Some(update) = app
            .updater()
            .map_err(|error| error.to_string())?
            .check()
            .await
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };
        let metadata = UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
        };
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        Ok(Some(DownloadedUpdate {
            update,
            bytes,
            metadata,
        }))
    }
    .await;

    match result {
        Ok(Some(pending)) => {
            let metadata = pending.metadata.clone();
            *manager
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(pending);
            manager.gate.mark_ready();
            Ok(Some(metadata))
        }
        Ok(None) => {
            manager.gate.reset();
            Ok(None)
        }
        Err(error) => {
            manager.gate.reset();
            Err(error)
        }
    }
}

#[tauri::command]
pub fn install_pending_update(
    app: AppHandle,
    manager: State<'_, UpdateManager>,
) -> Result<(), String> {
    if !manager.gate.begin_install() {
        return Err("没有可安装的更新".into());
    }
    let pending = manager
        .pending
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    let Some(pending) = pending else {
        manager.gate.reset();
        return Err("更新状态丢失，请重新下载".into());
    };

    if let Err(error) = pending.update.install(&pending.bytes) {
        *manager
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(pending);
        manager.gate.restore_ready();
        return Err(error.to_string());
    }

    app.restart();
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
}

#[cfg(windows)]
#[repr(C)]
struct LastInputInfo {
    size: u32,
    time: u32,
}

#[cfg(windows)]
#[link(name = "User32")]
extern "system" {
    fn GetLastInputInfo(info: *mut LastInputInfo) -> i32;
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn GetTickCount() -> u32;
}

#[tauri::command]
pub fn system_idle_seconds() -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    {
        // 0 = combined session state, u32::MAX = any input event.
        return Ok(idle_seconds_from_float(unsafe {
            CGEventSourceSecondsSinceLastEventType(0, u32::MAX)
        }));
    }

    #[cfg(windows)]
    {
        let mut info = LastInputInfo {
            size: std::mem::size_of::<LastInputInfo>() as u32,
            time: 0,
        };
        if unsafe { GetLastInputInfo(&mut info) } == 0 {
            return Err("无法读取 Windows 系统空闲时间".into());
        }
        return Ok(idle_seconds_from_ticks(
            unsafe { GetTickCount() },
            info.time,
        ));
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_update_check_can_start() {
        let gate = UpdateGate::default();

        assert!(gate.begin_check());
        assert!(!gate.begin_check());
        assert_eq!(gate.phase(), UpdatePhase::Checking);
    }

    #[test]
    fn a_ready_update_can_only_be_installed_once() {
        let gate = UpdateGate::default();
        assert!(gate.begin_check());
        assert!(gate.mark_ready());

        assert!(gate.begin_install());
        assert!(!gate.begin_install());
        assert_eq!(gate.phase(), UpdatePhase::Installing);
    }

    #[test]
    fn a_failed_install_can_be_retried() {
        let gate = UpdateGate::default();
        assert!(gate.begin_check());
        assert!(gate.mark_ready());
        assert!(gate.begin_install());

        assert!(gate.restore_ready());
        assert!(gate.begin_install());
    }

    #[test]
    fn a_failed_operation_returns_to_idle_for_retry() {
        let gate = UpdateGate::default();
        assert!(gate.begin_check());
        gate.reset();

        assert_eq!(gate.phase(), UpdatePhase::Idle);
        assert!(gate.begin_check());
    }

    #[test]
    fn windows_idle_seconds_handles_tick_count_wraparound() {
        assert_eq!(idle_seconds_from_ticks(2_000, 500), 1);
        assert_eq!(idle_seconds_from_ticks(500, u32::MAX - 499), 1);
    }

    #[test]
    fn macos_idle_seconds_rejects_invalid_native_values() {
        assert_eq!(idle_seconds_from_float(301.9), 301);
        assert_eq!(idle_seconds_from_float(-1.0), 0);
        assert_eq!(idle_seconds_from_float(f64::NAN), 0);
    }
}
