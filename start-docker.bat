@echo off
title Etsy Bulk Listing Tool - Docker Runner
echo ===================================================
echo   Etsy Bulk Listing Tool - Docker Uzerinde Baslatiliyor  
echo ===================================================
echo.

echo [+] Docker konteynerleri ayaga kaldiriliyor...
docker compose up -d

echo.
echo [+] Tarayici aciliyor...
:: Varsayilan tarayicida uygulamayi baslatir
start http://localhost:5173

echo.
echo ===================================================
echo   Uygulama Docker Uzerinde Aktif!
echo   - Arayuz (Frontend): http://localhost:5173
echo   - API Servisi (Backend): http://localhost:3001
echo.
echo   Uygulamayi kapatmak ve konteynerleri durdurmak icin
echo   lutfen terminalde bir tusa basin...
echo ===================================================
echo.
pause

echo.
echo [+] Konteynerler durduruluyor...
docker compose down

echo.
echo [+] Uygulama basariyla durduruldu.
pause
