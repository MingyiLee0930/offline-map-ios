#!/bin/bash
# 設定 iOS 專案：定位權限、背景定位、App 名稱、圖示與啟動畫面
set -euo pipefail
PL=ios/App/App/Info.plist

plutil -replace CFBundleDisplayName -string "離線地圖" "$PL"
plutil -replace NSLocationWhenInUseUsageDescription -string "用於在地圖上顯示你的位置、導航與記錄登山軌跡。" "$PL"
plutil -replace NSLocationAlwaysAndWhenInUseUsageDescription -string "鎖定螢幕或切換到其他 App 時，繼續記錄登山軌跡並在偏離路線時提醒你。" "$PL"
plutil -replace NSLocationAlwaysUsageDescription -string "鎖定螢幕時繼續記錄登山軌跡。" "$PL"
plutil -replace UIBackgroundModes -json '["location"]' "$PL"
plutil -replace LSApplicationQueriesSchemes -json '["sms","tel"]' "$PL"
plutil -replace ITSAppUsesNonExemptEncryption -bool NO "$PL"
plutil -replace UIFileSharingEnabled -bool YES "$PL"
plutil -replace LSSupportsOpeningDocumentsInPlace -bool YES "$PL"
plutil -replace UISupportedInterfaceOrientations -json '["UIInterfaceOrientationPortrait"]' "$PL"
plutil -lint "$PL"

ICON_DIR=ios/App/App/Assets.xcassets/AppIcon.appiconset
for f in "$ICON_DIR"/*.png; do cp resources/icon-1024.png "$f"; done
SPLASH_DIR=ios/App/App/Assets.xcassets/Splash.imageset
for f in "$SPLASH_DIR"/*.png; do cp resources/splash-2732.png "$f"; done
echo "iOS 專案設定完成"
