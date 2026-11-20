# Downloads the CC0 textures and sky HDRI from Poly Haven into assets/.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\get-assets.ps1 [-Res 1k|2k|4k] [-SkyRes 2k|4k] [-Force]
# -Force re-downloads files that already exist (use it to upgrade to higher resolution).
param([string]$Res = '1k', [string]$SkyRes = '2k', [switch]$Force)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path $PSScriptRoot '..\assets'
$tex = 'asphalt_02','brushed_concrete','gravel_concrete_03','red_brick_03','white_stucco','rectangular_paving',
       'painted_metal_shutter','brown_planks_09','metal_plate','concrete_tile_facade'
$map = [ordered]@{ 'Diffuse'='diff'; 'nor_gl'='nor'; 'arm'='arm' }

function Get-File($url, $out) {
  if ($url -notmatch '^https://dl\.polyhaven\.org/') { throw "unexpected url $url" }
  $tmp = "$out.part"
  for ($i = 1; $i -le 8; $i++) {
    & curl.exe -sS -L --fail --retry 3 --connect-timeout 30 -C - -o $tmp $url
    if ($LASTEXITCODE -eq 0) { Move-Item -Force $tmp $out; return }
    "  retry $i ($LASTEXITCODE)"; Start-Sleep -Seconds (2 * $i)
  }
  throw "failed: $url"
}

foreach ($id in $tex) {
  $dir = Join-Path $root "textures\$id"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $f = $null
  foreach ($k in $map.Keys) {
    $out = Join-Path $dir ($map[$k] + '.jpg')
    if (-not $Force -and (Test-Path $out) -and (Get-Item $out).Length -gt 10000) { continue }
    if (-not $f) { $f = Invoke-RestMethod "https://api.polyhaven.com/files/$id" -TimeoutSec 60 }
    Get-File $f.$k.$Res.jpg.url $out
    "ok $id $($map[$k])"
  }
}
New-Item -ItemType Directory -Force (Join-Path $root 'hdri') | Out-Null
$sky = Join-Path $root 'hdri\sky.hdr'
if ($Force -or -not ((Test-Path $sky) -and (Get-Item $sky).Length -gt 1000000)) {
  $hd = Invoke-RestMethod "https://api.polyhaven.com/files/kloofendal_48d_partly_cloudy_puresky" -TimeoutSec 60
  Get-File $hd.hdri.$SkyRes.hdr.url $sky
  "ok sky ($SkyRes)"
}
# character model (three.js example "Soldier", a Mixamo character: usable in the game, not redistributable on its own)
New-Item -ItemType Directory -Force (Join-Path $root 'models') | Out-Null
$model = Join-Path $root 'models\mixamo_soldier.glb'
if ($Force -or -not (Test-Path $model)) {
  & curl.exe -sS -L --fail --retry 5 -o $model 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb'
  "ok soldier model"
}
# gun recordings (CC0, OpenGameArt "Gunshot Sounds"), cut into clips by tools/slice-sounds.js
$raw = Join-Path $root 'sounds\raw'
New-Item -ItemType Directory -Force $raw | Out-Null
$zip = Join-Path $raw 'gunshot_sounds.zip'
if ($Force -or -not (Test-Path (Join-Path $root 'sounds\rifle_shot_1.wav'))) {
  & curl.exe -sS -L --fail --retry 5 -A 'Mozilla/5.0' -o $zip 'https://opengameart.org/sites/default/files/sounds.zip'
  Expand-Archive -Force $zip (Join-Path $raw 'zip')
  & node (Join-Path $PSScriptRoot 'slice-sounds.js')
  "ok sounds"
}
"DONE"
