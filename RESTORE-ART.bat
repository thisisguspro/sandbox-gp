@echo off
REM SANDBOX GP - restore the large art folders excluded from the delivery zip.
REM Usage:  RESTORE-ART.bat [path-to-bridge-game2000]   (default: ..\bridge-game2000)
set SRC=%1
if "%SRC%"=="" set SRC=..\bridge-game2000
set SRCP=%SRC%\game\bridge-client\public
set DST=game\bridge-client\public
if not exist "%SRCP%\characters" (
  echo ERROR: %SRCP%\characters not found. Pass the path to your bridge-game2000 folder.
  exit /b 1
)
for %%d in (characters items overlays) do (
  echo copying %%d ...
  xcopy /e /i /y "%SRCP%\%%d" "%DST%\%%d" >nul
)
echo Done. Art restored.
