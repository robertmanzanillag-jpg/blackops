Option Explicit
Dim shell, files, environment, key, nodePath, repoPath, configPath, entry, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
Set environment = shell.Environment("PROCESS")
If WScript.Arguments.Count <> 3 Then WScript.Quit 1
For Each key In Array("NODE_OPTIONS", "NODE_PATH", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR")
  If Len(environment(key)) > 0 Then WScript.Quit 1
Next
nodePath = WScript.Arguments(0)
repoPath = WScript.Arguments(1)
configPath = WScript.Arguments(2)
Function QuoteArgument(value)
  If InStr(value, Chr(34)) Or InStr(value, vbCr) Or InStr(value, vbLf) Or InStr(value, Chr(0)) Or InStr(value, "%") Or Right(value, 1) = "\" Then WScript.Quit 1
  If Len(value) < 3 Or Mid(value, 2, 2) <> ":\" Then WScript.Quit 1
  QuoteArgument = Chr(34) & value & Chr(34)
End Function
command = QuoteArgument(nodePath)
If LCase(files.GetFileName(nodePath)) <> "node.exe" Then WScript.Quit 1
entry = files.BuildPath(repoPath, "script\office-windows-worker.mjs")
command = command & " " & QuoteArgument(entry) & " --repo " & QuoteArgument(repoPath) & " --config " & QuoteArgument(configPath) & " --run"
If Not files.FileExists(nodePath) Or Not files.FileExists(entry) Or Not files.FileExists(configPath) Then WScript.Quit 1
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then WScript.Quit 1
WScript.Quit result
