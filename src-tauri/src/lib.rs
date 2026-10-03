use std::{
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{path::BaseDirectory, Manager};

struct BridgeBootstrap {
    child: Mutex<Option<Child>>,
    status_path: std::path::PathBuf,
    endpoint_path: std::path::PathBuf,
    owner: String,
}

#[tauri::command]
fn read_bridge_startup_status(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let bootstrap = app.state::<BridgeBootstrap>();
    match std::fs::read_to_string(&bootstrap.status_path) {
        Ok(status) => Ok(Some(status)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Nie można odczytać statusu mostu: {error}")),
    }
}

#[tauri::command]
fn read_bridge_endpoint(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let bootstrap = app.state::<BridgeBootstrap>();
    let raw = std::fs::read_to_string(&bootstrap.endpoint_path)
        .map_err(|_| "Most MT5 jeszcze się uruchamia.".to_string())?;
    let endpoint: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if endpoint["owner"].as_str() != Some(bootstrap.owner.as_str())
        || endpoint["protocol_version"].as_u64() != Some(3)
    {
        return Err("Niezgodna sesja lub wersja mostu MT5.".to_string());
    }
    Ok(endpoint)
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

fn start_bridge(app: &tauri::AppHandle) -> Result<BridgeBootstrap, String> {
    let script = bridge_script(app)?;
    let app_data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Nie można wyznaczyć katalogu danych aplikacji: {error}"))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Nie można przygotować katalogu danych: {error}"))?;
    let owner = format!("{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
    let status_path = app_data_dir.join(format!("bridge-startup-{owner}.json"));
    let endpoint_path = app_data_dir.join(format!("bridge-endpoint-{owner}.json"));
    let runtime_root = app_data_dir.join("mt5-bridge-runtime-v2");

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
        .arg(&status_path)
        .arg("-RuntimeRoot")
        .arg(runtime_root)
        .env("SMARTFLOW_MT5_PORT", "0")
        .env("SMARTFLOW_BRIDGE_OWNER", &owner)
        .env("SMARTFLOW_BRIDGE_ENDPOINT_FILE", &endpoint_path)
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

    let child = command.spawn().map_err(|error| format!("Nie udało się uruchomić mostu MT5: {error}"))?;
    Ok(BridgeBootstrap { child: Mutex::new(Some(child)), status_path, endpoint_path, owner })
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_bridge_startup_status, read_bridge_endpoint])
        .setup(|app| {
            let child = start_bridge(app.handle()).map_err(std::io::Error::other)?;
            app.manage(child);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("błąd inicjalizacji CRT Terminal")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(bootstrap) = app_handle.try_state::<BridgeBootstrap>() {
                    if let Ok(mut child) = bootstrap.child.lock() {
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
                    let _ = std::fs::remove_file(&bootstrap.endpoint_path);
                    let _ = std::fs::remove_file(&bootstrap.status_path);
                }
            }
        });
}
