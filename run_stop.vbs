' run_stop.vbs
' stop_hidden.ps1 dosyasini konsol penceresi acmadan calistirir.
' Yolu kendi bulundugu klasorden turetir, sabit yol yoktur.

Dim fso, shell, scriptDir, target
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
target = fso.BuildPath(scriptDir, "stop_hidden.ps1")

If Not fso.FileExists(target) Then
    MsgBox "stop_hidden.ps1 bulunamadi:" & vbCrLf & target, vbCritical, "Usalk Helper"
    WScript.Quit 1
End If

shell.CurrentDirectory = scriptDir
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & target & """", 0, True
