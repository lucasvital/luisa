@echo off
rem Roda o gravador da camera; a saida vai para gravador.log. ligar-com-windows.ps1 faz ele abrir sozinho com o Windows, sem janela.
cd /d "%~dp0"
node --env-file=.env gravador.js >> gravador.log 2>&1
