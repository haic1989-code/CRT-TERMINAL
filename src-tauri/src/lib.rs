use std::{
    net::{SocketAddr, TcpStream},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{path::BaseDirectory, Manager};

struct BridgeBootstrap(Mutex<Option<Child>>);

#[tauri::command]
fn read_bridge_startup_status(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let status_path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Nie można wyznaczyć katalogu danych mostu: {error}"))?
        .join("bridge-startup.json");
    match std::fs::read_to_string(status_path) {
        Ok(status) => Ok(Some(status)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Nie można odczytać statusu mostu: {error}")),
    }
}

fn bridge_is_listening() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], 8765));
    TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn bridge_script(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(resource) = app
        .path()
        .resolve("mt5-bridge/start.ps1", BaseDirectory::Resource)
    {
        if resource.is_file() {
            return Ok(resource);
        }
    }

    let manifest_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let development_script = manifest_root
        .join("..")
        .join("mt5-bridge")
        .join("start.ps1");
    development_script
        .canonicalize()
        .map_err(|error| format!("Nie znaleziono skryptu mostu MT5: {error}"))
}

fn start_bridge(app: &tauri::AppHandle) -> Result<Option<Child>, String> {
    if bridge_is_listening() {
        return Ok(None);
    }

    let script = bridge_script(app)?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Nie można wyznaczyć katalogu danych aplikacji: {error}"))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Nie można przygotować katalogu danych: {error}"))?;
    let status_path = app_data_dir.join("bridge-startup.json");
    let runtime_root = app_data_dir.join("mt5-bridge-runtime");

    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .arg("-StartupStatusPath")
        .arg(status_path)
        .arg("-RuntimeRoot")
        .arg(runtime_root)
        // Packaged GUI apps can inherit a working directory that PowerShell
        // cannot map to a filesystem drive. The bridge script uses absolute
        // paths, but a valid cwd also makes PowerShell startup deterministic.
        .current_dir(
            script
                .parent()
                .ok_or("Nieprawidłowa ścieżka skryptu mostu")?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    command
        .spawn()
        .map(Some)
        .map_err(|error| format!("Nie udało się uruchomić mostu MT5: {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_bridge_startup_status])
        .setup(|app| {
            let child = start_bridge(app.handle()).map_err(std::io::Error::other)?;
            app.manage(BridgeBootstrap(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("błąd inicjalizacji CRT Terminal")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(bootstrap) = app_handle.try_state::<BridgeBootstrap>() {
                    if let Ok(mut child) = bootstrap.0.lock() {
                        if let Some(mut process) = child.take() {
                            if process.try_wait().ok().flatten().is_none() {
                                let pid = process.id().to_string();
                                let _ = Command::new("taskkill.exe")
                                    .args(["/PID", &pid, "/T", "/F"])
                                    .stdout(Stdio::null())
                                    .stderr(Stdio::null())
                                    .status();
                            }
                        }
                    }
                }
            }
        });
}
