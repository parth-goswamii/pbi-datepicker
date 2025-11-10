@echo off
setlocal
echo ============================================
echo Building Power BI Visual
echo ============================================

if exist node_modules (rmdir /S /Q node_modules)
if exist package-lock.json (del /F /Q package-lock.json)

echo [1/3] Installing dependencies...
npm install

echo [2/3] Packaging...
npx pbiviz package

echo [3/3] Done. Check .tmp\drop\ for the .pbiviz
