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
  if ($url -notmatch '^https://(dl\.polyhaven\.org|static\.poly\.pizza)/') { throw "unexpected url $url" }
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
# pedestrians / targets: 15 animated characters by Quaternius (CC0) from poly.pizza
$people = Join-Path $root 'models\people'
New-Item -ItemType Directory -Force $people | Out-Null
$ppl = [ordered]@{
  business_man = 'e599abbe-7d73-488c-9d7e-3ead281e705c'; casual = '90a9e2d4-053f-42f1-99a2-8f5e1180ea7f'; hoodie = 'bcd66ec5-5e81-4901-a222-47abc875fe2a'
  worker = '3a5f3056-ffe6-42eb-bd52-122afcbd22b2'; farmer = '81f2f0cf-6f53-4b57-92ea-dba0928620f2'; woman_b = 'ba7a1955-ea51-4cb9-a561-188bdef0a6c7'
  woman_c = '46d6db5a-3c9f-4238-8cdf-8eb7194498dc'; woman_casual = '51d5abdd-bb87-4b8d-9967-21738ffb8437'; man_in_suit = '66b57880-bcb0-479a-8d72-5c3e88afaa39'
  adventurer = '69689495-028d-4b81-8678-792338a5693e'; woman_tank = '9a6a3e55-23ce-4d5c-89bc-7d3f30307ed0'; woman_plain = '906a0cbe-b0a4-4312-b898-0f974b6f6771'
  woman_dress = 'a642af96-e239-4c5f-b50d-7661ff51deec'; punk_a = 'e56f23b5-3270-406f-8924-f77cad980c43'; punk_b = '1d368679-1d9a-4d5c-9095-877144b02d00'
}
foreach ($k in $ppl.Keys) {
  $out = Join-Path $people "$k.glb"
  if ($Force -or -not (Test-Path $out)) { Get-File "https://static.poly.pizza/$($ppl[$k]).glb" $out; "ok person $k" }
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
