# Image Parameter Matcher — Android v1.11.0 Live Matcher Alpha 1

Experimental branch based on v1.10.8 Thumbnail Download.

## Existing functionality retained
- Search / Add Image / Library / Settings
- Existing Pattern templates
- View → Edit → Download → Delete dataset actions
- Thumbnail-only PNG downloads
- Aggressive streaming backup/import path
- Existing IndexedDB data model and backup format

## New: Live Matcher Phase 1
This alpha validates Android overlay and MediaProjection screen capture before visual dataset recognition is added.

### Test steps
1. Build/install this branch and open Image Matcher.
2. Open **Settings** in Image Matcher.
3. Under **Live Matcher — Experimental**, tap **Enable Live Matcher**.
4. If Android opens **Display over other apps**, allow Image Matcher. Return to the app and tap **Enable Live Matcher** again.
5. Approve Android's screen-capture prompt.
6. Switch to Wittle Defender.
7. A draggable **SCAN** bubble should remain above the game.
8. Drag the bubble to a convenient location.
9. Tap **SCAN**. The bubble briefly hides so it is not part of the captured frame.
10. A preview overlay should appear showing the screen that the future matcher will analyze.
11. Use **Scan Again** for another capture or **Close** to return to the small bubble.
12. To end the capture session, use **Stop Live Matcher** in Image Matcher or **Stop** on the persistent Android notification.

### What to report after testing
- Does the SCAN bubble appear over WD?
- Can it be dragged without interfering with the game?
- Does tapping SCAN show the correct current WD screen?
- Is the capture full-resolution/uncropped and oriented correctly?
- Is any part black, blank, shifted, stretched, or rotated?
- Does Scan Again work repeatedly?

## Not implemented in Alpha 1
- Treasure/object recognition
- Orientation recognition
- Grid detection
- Automatic dataset lookup
- Match-result overlay

Those are intentionally deferred until screen capture is verified on the target device.

## GitHub build
The included `.github/workflows/build-apk.yml` builds the debug APK on GitHub Actions. Upload the project contents to the Android app branch and run **Build Android APK**.
