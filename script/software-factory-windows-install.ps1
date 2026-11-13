param([Parameter(Mandatory=$true)][string]$NodePath,[Parameter(Mandatory=$true)][string]$RepoPath,[Parameter(Mandatory=$true)][string]$ConfigPath,[switch]$Apply)
$ErrorActionPreference='Stop'
function Quote-FactoryArgument([string]$Value){
 if($Value -notmatch '^[A-Za-z]:\\' -or $Value -match '["%\r\n]' -or $Value.EndsWith('\')){throw 'Unsafe local path'}
 return '"'+$Value+'"'
}
try{
 foreach($key in @('NODE_OPTIONS','NODE_PATH','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR')){if([Environment]::GetEnvironmentVariable($key)){throw 'Unsafe inherited environment'}}
 $node=(Resolve-Path -LiteralPath $NodePath).Path
 $repo=(Resolve-Path -LiteralPath $RepoPath).Path.TrimEnd('\')
 $config=(Resolve-Path -LiteralPath $ConfigPath).Path
 foreach($value in @($node,$repo,$config)){$null=Quote-FactoryArgument $value}
 if([IO.Path]::GetFileName($node) -ine 'node.exe'){throw 'Node executable required'}
 $launcher=Join-Path $repo 'script\software-factory-windows-launch.vbs'
 if(-not(Test-Path -LiteralPath $launcher -PathType Leaf)){throw 'Reviewed launcher missing'}
 & $node (Join-Path $repo 'script\software-factory-windows-worker.mjs') --repo $repo --config $config --preflight
 if($LASTEXITCODE -ne 0){throw 'Preflight failed'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $hash=[Security.Cryptography.SHA256]::Create()
 try{$suffix=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes("$sid|$repo|$config")))).Replace('-','').Substring(0,16)}finally{$hash.Dispose()}
 $name="AsistenteSoftwareFactory-$suffix"
 $marker="Asistente Software Factory managed task v1 $suffix"
 $executable=Join-Path $env:SystemRoot 'System32\wscript.exe'
 $arguments='//B //NoLogo '+(Quote-FactoryArgument $launcher)+' '+(Quote-FactoryArgument $node)+' '+(Quote-FactoryArgument $repo)+' '+(Quote-FactoryArgument $config)
 # Never overwrite an existing task, including Office or Kong tasks.
 if(Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue){throw 'Task already exists; inspect it separately'}
 $action=New-ScheduledTaskAction -Execute $executable -Argument $arguments -WorkingDirectory $repo
 $login=New-ScheduledTaskTrigger -AtLogOn -User $sid
 $recovery=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
 $principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
 $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 if(-not $Apply){Write-Output "Validated dry run: $name; no task registered. Requires this PC awake, online and signed in.";exit 0}
 Register-ScheduledTask -TaskName $name -TaskPath '\' -Action $action -Trigger @($login,$recovery) -Principal $principal -Settings $settings -Description $marker | Out-Null
 Write-Output "Registered $name with logon and five-minute triggers. No immediate execution requested."
}catch{Write-Error 'Factory task not registered. Check private configuration, reviewed paths and existing task ownership. No credentials are logged.';exit 1}
