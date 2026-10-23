@echo off
rem Inicia a gravacao da camera do berco. Para abrir junto com o Windows, coloque um atalho deste arquivo em shell:startup
node --env-file="%~dp0.env" "%~dp0gravador.js"
pause
