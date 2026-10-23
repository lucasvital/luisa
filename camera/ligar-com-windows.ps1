# Liga o gravador junto com o Windows, sem janela, e religa em até 5 min se ele parar. Saída em camera\gravador.log.
# Rodar uma vez:  powershell -ExecutionPolicy Bypass -File camera\ligar-com-windows.ps1
# Desligar:       Unregister-ScheduledTask -TaskName 'Luisa - camera do berco'
$acao = New-ScheduledTaskAction -Execute conhost.exe -Argument '--headless cmd /c iniciar.cmd' -WorkingDirectory $PSScriptRoot
$quando = (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME), (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5))
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit 0 -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'Luisa - camera do berco' -Action $acao -Trigger $quando -Settings $config -Force | Out-Null
Start-ScheduledTask -TaskName 'Luisa - camera do berco'
