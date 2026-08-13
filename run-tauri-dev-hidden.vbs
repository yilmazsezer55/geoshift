Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptPath = WScript.ScriptFullName
scriptFolder = FSO.GetParentFolderName(scriptPath)

command = "cmd.exe /c cd /d """ & scriptFolder & """ && npm run tauri dev"
WshShell.Run command, 0, false
