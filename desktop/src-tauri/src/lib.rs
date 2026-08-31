use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{App, Manager, RunEvent};

struct RuntimeProcess(Mutex<Option<Child>>);

struct DesktopInstanceLock {
    path: PathBuf,
}

impl Drop for DesktopInstanceLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn instance_lock_path() -> PathBuf {
    std::env::temp_dir().join("mes-desktop-com.zc.mes.desktop.lock")
}

fn process_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        return Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|status| status.success())
            .unwrap_or(true);
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

fn acquire_instance_lock() -> Result<DesktopInstanceLock, String> {
    let path = instance_lock_path();
    let mut file = loop {
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => break file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let owner_pid = fs::read_to_string(&path)
                    .ok()
                    .and_then(|content| content.strip_prefix("pid=")?.trim().parse().ok());
                if owner_pid.is_some_and(process_is_alive) {
                    return Err(format!(
                        "MES 桌面端已经在运行（锁文件：{}）",
                        path.display()
                    ));
                }
                fs::remove_file(&path).map_err(|remove_error| {
                    format!("无法清理失效的桌面端单实例锁：{remove_error}")
                })?;
            }
            Err(error) => return Err(format!("无法创建桌面端单实例锁：{error}")),
        }
    };
    if let Err(error) = writeln!(file, "pid={}", std::process::id()) {
        let _ = fs::remove_file(&path);
        return Err(format!("无法写入桌面端单实例锁：{error}"));
    }
    Ok(DesktopInstanceLock { path })
}

fn find_repo_root(start: &Path) -> Option<PathBuf> {
    start.ancestors().find_map(|candidate| {
        (candidate.join("backend/package.json").is_file()
            && candidate.join("simulator/package.json").is_file())
        .then(|| candidate.to_path_buf())
    })
}

fn runtime_script(app: &App) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("MES_DESKTOP_RUNTIME") {
        return Some(PathBuf::from(path));
    }
    let bundled = app.path().resource_dir().ok()?.join("desktop-runtime.sh");
    if bundled.is_file() {
        return Some(bundled);
    }
    find_repo_root(&std::env::current_exe().ok()?)
        .map(|root| root.join("scripts/desktop-runtime.sh"))
}

fn repo_root(app: &App) -> Option<PathBuf> {
    for variable in ["MES_DEMO_ROOT", "MES_REPO_ROOT"] {
        if let Some(path) = std::env::var_os(variable) {
            let candidate = PathBuf::from(path);
            if candidate.join("backend/package.json").is_file()
                && candidate.join("simulator/package.json").is_file()
            {
                return Some(candidate);
            }
        }
    }
    find_repo_root(&std::env::current_exe().ok()?).or_else(|| {
        app.path()
            .resource_dir()
            .ok()
            .and_then(|path| find_repo_root(&path))
    })
}

fn show_startup_error(message: &str) {
    #[cfg(target_os = "macos")]
    {
        // Pass the message as an argv value instead of interpolating it into
        // AppleScript; paths and service errors may contain quotes/newlines.
        let script = r#"on run argv
  set failureMessage to item 1 of argv
  display dialog ("MES 演示启动失败：" & failureMessage) buttons {"知道了"} default button "知道了" with icon stop
end run"#;
        let _ = Command::new("/usr/bin/osascript")
            .args(["-e", script, "--", message])
            .status();
    }
    eprintln!("MES desktop startup failed: {message}");
}

fn start_runtime(app: &App) -> Result<Child, String> {
    let script = runtime_script(app).ok_or_else(|| "找不到 desktop-runtime.sh".to_string())?;
    let root = repo_root(app)
        .ok_or_else(|| "找不到包含 backend 和 simulator 的演示运行目录".to_string())?;
    Command::new("bash")
        .arg(script)
        .arg(format!("--repo-root={}", root.display()))
        .env("MES_DESKTOP_MODE", "demo")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("无法启动桌面运行时：{error}"))
}

fn stop_runtime(state: &RuntimeProcess) {
    let Ok(mut process) = state.0.lock() else {
        eprintln!("MES desktop runtime lock is poisoned; cleanup skipped");
        return;
    };
    let Some(mut child) = process.take() else {
        return;
    };
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status();
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let instance_lock = match acquire_instance_lock() {
        Ok(lock) => lock,
        Err(error) => {
            eprintln!("MES desktop startup skipped: {error}");
            return;
        }
    };
    let app = tauri::Builder::default()
        // Register before window startup so a second launch focuses the
        // existing window instead of creating another local service session.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .setup(|app| {
            app.manage(instance_lock);
            if std::env::var("MES_DESKTOP_MANAGED").as_deref() == Ok("0")
                || std::env::var("MES_DESKTOP_MODE").as_deref() == Ok("production")
            {
                return Ok(());
            }
            match start_runtime(app) {
                Ok(process) => {
                    app.manage(RuntimeProcess(Mutex::new(Some(process))));
                }
                Err(error) => show_startup_error(&error),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MES desktop application");

    app.run(|app, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = app.try_state::<RuntimeProcess>() {
                stop_runtime(&state);
            }
        }
    });
}
