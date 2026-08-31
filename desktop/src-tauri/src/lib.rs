use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{App, Manager, RunEvent};

struct RuntimeProcess(Mutex<Option<Child>>);

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
    find_repo_root(&std::env::current_exe().ok()?).map(|root| root.join("scripts/desktop-runtime.sh"))
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
    find_repo_root(&std::env::current_exe().ok()?)
        .or_else(|| app.path().resource_dir().ok().and_then(|path| find_repo_root(&path)))
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
    let root = repo_root(app).ok_or_else(|| "找不到包含 backend 和 simulator 的演示运行目录".to_string())?;
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
        let _ = Command::new("kill").args(["-TERM", &child.id().to_string()]).status();
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
