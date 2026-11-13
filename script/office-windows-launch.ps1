param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$RepoPath,
  [Parameter(Mandatory=$true)][string]$ConfigPath
)
$ErrorActionPreference = 'Stop'
try {
  foreach ($key in @('NODE_OPTIONS','NODE_PATH','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR')) {
    if ([Environment]::GetEnvironmentVariable($key)) { throw 'Unsafe inherited Node environment' }
  }
  foreach ($key in @('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGOPTIONS','PGSERVICE','PGSERVICEFILE')) { [Environment]::SetEnvironmentVariable($key,$null,'Process') }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Get-Acl -LiteralPath $ConfigPath
  foreach ($rule in $acl.Access) {
    $identity = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and $identity -notin @($sid,'S-1-5-18','S-1-5-32-544')) { throw 'Configuration ACL is not private' }
  }
  $entry = Join-Path $RepoPath 'script\office-windows-worker.mjs'
  & $NodePath $entry --repo $RepoPath --config $ConfigPath --run
  exit $LASTEXITCODE
} catch { Write-Error 'Office worker launch failed. No credentials are logged.'; exit 1 }
