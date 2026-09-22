# agendar_bi_compras.ps1
#
# Cria (ou substitui) DUAS tarefas agendadas do Windows, de uma vez so:
#
#   1) "BI Compras - Sync rapidas"  -> 08:00, 12:00, 18:00 e 00:00
#      Roda todas as consultas do BI Compras, menos o faturamento.
#
#   2) "BI Compras - Sync faturamento" -> 03:00
#      Roda so a Consulta10 (faturamento, ~1,6 milhao de linhas). Separada
#      porque e pesada no Oracle e os dados nao mudam de hora em hora.
#
# Como rodar (uma vez só):
#   1. Abra o PowerShell "Como Administrador".
#   2. cd "P:\INTEGRAÇÃO BI\COMPRAS"
#   3. powershell -ExecutionPolicy Bypass -File .\agendar_bi_compras.ps1
#   4. Digite a MESMA senha que voce usa pra logar no Windows nessa maquina
#      (necessario para a tarefa enxergar a pasta de rede P:\ mesmo com
#      ninguem logado na tela).
#
# IMPORTANTE: rode o diagnostico_bi_compras.py ANTES de agendar, para
# confirmar que todas as consultas estao funcionando.

$ErrorActionPreference = "Stop"

$pastaTrabalho = "P:\INTEGRAÇÃO BI\COMPRAS"
$script        = "P:\INTEGRAÇÃO BI\COMPRAS\sync_bi_compras.py"

if (-not (Test-Path $script)) {
    throw "Nao encontrei o script em $script. Confira se a pasta de rede esta acessivel."
}

$config = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5)

$cred = Get-Credential `
    -Message "Digite a senha do Windows do usuario $env:USERNAME (necessario para as tarefas acessarem a pasta de rede mesmo deslogado)" `
    -UserName "$env:USERDOMAIN\$env:USERNAME"

function Registrar-Tarefa {
    param($Nome, $Argumento, $Horarios, $Descricao)

    $acao = New-ScheduledTaskAction -Execute "python" -Argument $Argumento -WorkingDirectory $pastaTrabalho
    $gatilhos = foreach ($h in $Horarios) { New-ScheduledTaskTrigger -Daily -At (Get-Date $h) }

    Register-ScheduledTask `
        -TaskName $Nome `
        -Action $acao `
        -Trigger $gatilhos `
        -Settings $config `
        -User $cred.UserName `
        -Password $cred.GetNetworkCredential().Password `
        -RunLevel Highest `
        -Description $Descricao `
        -Force | Out-Null

    Write-Host "  [ok] $Nome  ->  $($Horarios -join ', ')"
}

Write-Host ""
Write-Host "Criando as tarefas do BI Compras..."

Registrar-Tarefa `
    -Nome "BI Compras - Sync rapidas" `
    -Argumento "`"$script`" --grupo rapidas" `
    -Horarios @("08:00", "12:00", "18:00", "00:00") `
    -Descricao "BI Compras: dimensoes, ruptura/cobertura, estoque x venda, verba, avaria, excesso e sugestoes (Oracle/WinThor -> Supabase)."

Registrar-Tarefa `
    -Nome "BI Compras - Sync faturamento" `
    -Argumento "`"$script`" --grupo pesadas" `
    -Horarios @("03:00") `
    -Descricao "BI Compras: fato de faturamento (Consulta10, ~1,6 milhao de linhas). Roda 1x por dia de madrugada."

Write-Host ""
Write-Host "Pronto! As duas tarefas estao criadas."
Write-Host "Confira em: Agendador de Tarefas (taskschd.msc) > Biblioteca do Agendador de Tarefas"
Write-Host ""
Write-Host "Se a tarefa antiga 'BI Compras - Sync' (que rodava so o sync_compras.py)"
Write-Host "ainda existir, desative ou apague ela para nao rodar duas vezes."
Write-Host ""
