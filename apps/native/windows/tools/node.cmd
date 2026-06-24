@echo off
setlocal

set "NODE_EXE="
for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE_EXE (
  echo node.exe was not found in PATH or Program Files. 1>&2
  exit /b 9009
)

"%NODE_EXE%" %*
exit /b %ERRORLEVEL%
