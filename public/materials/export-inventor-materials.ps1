# Run in Windows PowerShell 5.1 with Inventor open and any document active.
# Reads loaded libraries. Does not alter materials, documents or libraries.
param([string]$OutputPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'inventor-materials.json'))
$ErrorActionPreference = 'Stop'
$app = [Runtime.InteropServices.Marshal]::GetActiveObject('Inventor.Application')
if ($null -eq $app.ActiveDocument) { throw 'Abra uma peca ou montagem no Inventor antes de exportar.' }
$uom = $app.ActiveDocument.UnitsOfMeasure
$specs = @(
    @('density','structural_Density','kg/m^3'),
    @('young','structural_Young_modulus','MPa'),
    @('poisson','structural_Poisson_ratio',''),
    @('shear','structural_Shear_modulus','MPa'),
    @('yieldStress','structural_Minimum_yield_stress','MPa'),
    @('tensileStrength','structural_Minimum_tensile_strength','MPa'),
    @('conductivity','structural_Thermal_conductivity','W/(m*K)'),
    @('expansion','structural_Thermal_expansion_coefficient','1/K'),
    @('specificHeat','structural_Specific_heat','J/(kg*K)')
)
function Read-Number($asset, [string]$name) {
    try {
        $v = $asset.Item($name)
        if ($v.HasMultipleValues) { return $null }
        $n = [double]$v.Value
        if ([double]::IsNaN($n) -or [double]::IsInfinity($n)) { return $null }
        return $n
    } catch { return $null }
}
function Read-Asset($asset) {
    $entries = @()
    if ($null -eq $asset) { return ,$entries }
    foreach ($v in $asset) {
        $entry = [ordered]@{name=[string]$v.Name;label=[string]$v.DisplayName;type=[int]$v.ValueType}
        try { $entry.units = [string]$v.Units } catch {}
        try {
            $value = $v.Value
            if ($value -is [string] -or $value -is [ValueType]) { $entry.value = $value }
            elseif ($null -ne $value.Red) { $entry.value = @([int]$value.Red,[int]$value.Green,[int]$value.Blue,[int]$value.Opacity) }
            else { $entry.note = 'Objeto/textura do Inventor; consulte a biblioteca de origem.' }
        } catch { $entry.note = 'Valor nao escalar ou indisponivel.' }
        $entries += $entry
    }
    return ,$entries
}
$materials = @(); $raw = @(); $errors = @()
foreach ($library in $app.AssetLibraries) {
    foreach ($material in $library.MaterialAssets) {
        try {
            $physical = [ordered]@{}; $warnings = @()
            $asset = $material.PhysicalPropertiesAsset
            foreach ($spec in $specs) {
                $physical[$spec[0]] = $null
                try {
                    $v = $asset.Item($spec[1])
                    if ($v.HasMultipleValues) { throw 'Propriedade com multiplos valores.' }
                    $n = [double]$v.Value
                    if ($spec[2]) {
                        if (-not $v.Units) { throw 'Unidade de origem ausente.' }
                        $n = [double]$uom.ConvertUnits($n, [string]$v.Units, $spec[2])
                    }
                    if ([double]::IsNaN($n) -or [double]::IsInfinity($n)) { throw 'Valor nao finito.' }
                    $physical[$spec[0]] = $n
                } catch { $warnings += ($spec[0] + ': ausente ou nao convertido; conferir no Inventor.') }
            }
            $look = $material.AppearanceAsset
            $color = '#8b959e'; $metalness = 0.15; $roughness = 0.55; $opacity = 1.0
            foreach ($colorKey in @('generic_diffuse','metal_color','opaque_albedo','paint_color','glazing_transmittance_color')) {
                try {
                    $c = $look.Item($colorKey).Value
                    if ($null -eq $c.Red) { continue }
                    $color = '#{0:X2}{1:X2}{2:X2}' -f [int]$c.Red,[int]$c.Green,[int]$c.Blue
                    if ($colorKey -eq 'metal_color') { $metalness = 0.85 }
                    break
                } catch {}
            }
            $gloss = Read-Number $look 'generic_glossiness'
            if ($null -ne $gloss -and $gloss -ge 0 -and $gloss -le 1) { $roughness = [Math]::Max(0.05, 1-$gloss) }
            $transparency = Read-Number $look 'generic_transparency'
            if ($null -ne $transparency -and $transparency -ge 0 -and $transparency -le 1) { $opacity = 1-$transparency }
            $id = [string]$library.InternalName + ':' + [string]$material.Name
            $materials += [ordered]@{
                id=$id;name=[string]$material.DisplayName;category=[string]$material.CategoryName
                source=('Inventor / '+[string]$library.DisplayName+' / '+[string]$library.InternalName)
                notes=('Exportado em '+[DateTime]::UtcNow.ToString('u')+'. Aparencia aproximada; texturas nao incorporadas. Confirme comportamento isotropico antes da analise. '+($warnings -join ' '))
                behavior='unknown';physical=$physical
                appearance=@{color=$color;metalness=$metalness;roughness=$roughness;opacity=$opacity}
            }
            $raw += [ordered]@{id=$id;physical=(Read-Asset $asset);appearance=(Read-Asset $look)}
        } catch { $errors += ([string]$material.DisplayName+': '+$_.Exception.Message) }
    }
}
if ($materials.Count -eq 0) { throw 'Nenhum material exportado. Verifique as bibliotecas carregadas no projeto do Inventor.' }
$json = @{format='eksteel-materials';version=1;materials=$materials} | ConvertTo-Json -Depth 15
[IO.File]::WriteAllText($OutputPath,$json,(New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText(($OutputPath+'.raw.json'),(@{assets=$raw;errors=$errors}|ConvertTo-Json -Depth 15),(New-Object Text.UTF8Encoding($false)))
Write-Host ($materials.Count.ToString()+' materiais exportados para '+$OutputPath)
if ($errors.Count) { Write-Warning ($errors.Count.ToString()+' materiais nao puderam ser exportados. Consulte o arquivo .raw.json.') }
