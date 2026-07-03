@echo off
setlocal EnableExtensions

set "REPO_ROOT=%~dp0..\.."
for %%I in ("%REPO_ROOT%") do set "REPO_ROOT=%%~fI"

set "SF_BIN=%REPO_ROOT%\node_modules\.bin\sf.cmd"
if not exist "%SF_BIN%" (
  echo Salesforce CLI is not installed. Run: npm.cmd install --save-dev @salesforce/cli --cache C:\tmp\npm-cache
  exit /b 1
)

cmd /c "set USERPROFILE=%REPO_ROOT%&& set HOME=%REPO_ROOT%&& set SF_CONFIG_DIR=%REPO_ROOT%\.sf&& ""%SF_BIN%"" %*"
exit /b %ERRORLEVEL%
