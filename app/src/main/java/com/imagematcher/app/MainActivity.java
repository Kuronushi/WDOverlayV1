package com.imagematcher.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.media.projection.MediaProjectionManager;
import android.provider.Settings;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.BufferedReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int SAVE_FILE_REQUEST = 1002;
    private static final int SAVE_IMAGE_REQUEST = 1003;
    private static final int SCREEN_CAPTURE_REQUEST = 1004;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private File pendingExportFile;
    private BufferedOutputStream pendingExportStream;
    private String pendingExportName;
    private Uri selectedFileUri;
    private BufferedReader pendingImportReader;
    private File pendingImageFile;
    private String pendingImageName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception error) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "Could not open file picker.", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    private synchronized void closeExportStream() {
        if (pendingExportStream != null) {
            try { pendingExportStream.close(); } catch (Exception ignored) { }
            pendingExportStream = null;
        }
    }

    private synchronized void clearExportState(boolean deleteFile) {
        closeExportStream();
        if (deleteFile && pendingExportFile != null) pendingExportFile.delete();
        pendingExportFile = null;
        pendingExportName = null;
    }

    private synchronized void closeImportReader() {
        if (pendingImportReader != null) {
            try { pendingImportReader.close(); } catch (Exception ignored) { }
            pendingImportReader = null;
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public synchronized boolean beginTextExport(String filename) {
            try {
                clearExportState(true);
                pendingExportName = filename;
                pendingExportFile = File.createTempFile("image-matcher-backup-", ".json", getCacheDir());
                pendingExportStream = new BufferedOutputStream(new FileOutputStream(pendingExportFile));
                return true;
            } catch (Exception error) {
                clearExportState(true);
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean appendTextChunk(String chunk) {
            try {
                if (pendingExportStream == null || chunk == null) return false;
                pendingExportStream.write(chunk.getBytes(StandardCharsets.UTF_8));
                return true;
            } catch (Exception error) {
                clearExportState(true);
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean finishTextExport() {
            try {
                if (pendingExportStream == null || pendingExportFile == null) return false;
                pendingExportStream.flush();
                closeExportStream();
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("application/json");
                    intent.putExtra(Intent.EXTRA_TITLE, pendingExportName == null ? "image-matcher-backup.json" : pendingExportName);
                    try {
                        startActivityForResult(intent, SAVE_FILE_REQUEST);
                    } catch (Exception error) {
                        Toast.makeText(MainActivity.this, "Could not open the save location picker.", Toast.LENGTH_LONG).show();
                        clearExportState(true);
                    }
                });
                return true;
            } catch (Exception error) {
                clearExportState(true);
                return false;
            }
        }

        @JavascriptInterface
        public synchronized void cancelTextExport() {
            clearExportState(true);
        }

        @JavascriptInterface
        public synchronized boolean beginSelectedTextImport() {
            closeImportReader();
            if (selectedFileUri == null) return false;
            try {
                InputStream input = getContentResolver().openInputStream(selectedFileUri);
                if (input == null) return false;
                pendingImportReader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8), 1024 * 1024);
                return true;
            } catch (Exception error) {
                closeImportReader();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized String readSelectedTextChunk(int requestedChars) {
            if (pendingImportReader == null) return null;
            int size = Math.max(4096, Math.min(requestedChars, 1024 * 1024));
            char[] buffer = new char[size];
            try {
                int read = pendingImportReader.read(buffer);
                if (read < 0) {
                    closeImportReader();
                    return null;
                }
                return new String(buffer, 0, read);
            } catch (Exception error) {
                closeImportReader();
                return null;
            }
        }

        @JavascriptInterface
        public synchronized void finishSelectedTextImport() {
            closeImportReader();
        }

        @JavascriptInterface
        public String startLiveMatcher() {
            if (!Settings.canDrawOverlays(MainActivity.this)) {
                runOnUiThread(() -> {
                    Intent permission = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                    try { startActivity(permission); }
                    catch (Exception e) { Toast.makeText(MainActivity.this, "Open Android Settings and allow Display over other apps.", Toast.LENGTH_LONG).show(); }
                });
                return "overlay_permission";
            }
            runOnUiThread(() -> {
                MediaProjectionManager manager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST);
            });
            return "capture_permission";
        }

        @JavascriptInterface
        public void stopLiveMatcher() {
            runOnUiThread(() -> stopService(new Intent(MainActivity.this, LiveMatcherService.class)));
        }

        @JavascriptInterface
        public synchronized boolean saveImageBase64(String dataUrl, String filename) {
            try {
                int comma = dataUrl.indexOf(',');
                if (comma < 0) return false;
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                if (pendingImageFile != null) pendingImageFile.delete();
                pendingImageFile = File.createTempFile("image-matcher-map-", ".png", getCacheDir());
                try (FileOutputStream out = new FileOutputStream(pendingImageFile)) { out.write(bytes); }
                pendingImageName = (filename == null || filename.trim().isEmpty()) ? "image-matcher-map.png" : filename;
                runOnUiThread(() -> {
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/png");
                    intent.putExtra(Intent.EXTRA_TITLE, pendingImageName);
                    try { startActivityForResult(intent, SAVE_IMAGE_REQUEST); }
                    catch (Exception error) { Toast.makeText(MainActivity.this, "Could not open image save picker.", Toast.LENGTH_LONG).show(); }
                });
                return true;
            } catch (Exception error) {
                if (pendingImageFile != null) pendingImageFile.delete();
                pendingImageFile = null; pendingImageName = null;
                return false;
            }
        }

    }

    private OutputStream openBackupOutputStream(Uri uri) throws Exception {
        try {
            OutputStream out = getContentResolver().openOutputStream(uri, "rwt");
            if (out != null) return out;
        } catch (Exception ignored) { }
        OutputStream out = getContentResolver().openOutputStream(uri, "w");
        if (out == null) throw new IllegalStateException("Unable to open destination file.");
        return out;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SCREEN_CAPTURE_REQUEST) {
            if (resultCode == RESULT_OK && data != null) {
                Intent service = new Intent(this, LiveMatcherService.class);
                service.setAction(LiveMatcherService.ACTION_START);
                service.putExtra("resultCode", resultCode);
                service.putExtra("resultData", data);
                if (android.os.Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
                Toast.makeText(this, "Live Matcher enabled. Switch to the game and tap SCAN.", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "Screen capture permission was not granted.", Toast.LENGTH_SHORT).show();
            }
        } else if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            if (results != null && results.length > 0) selectedFileUri = results[0];
            if (fileCallback != null) fileCallback.onReceiveValue(results);
            fileCallback = null;
        } else if (requestCode == SAVE_FILE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingExportFile != null) {
                try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(pendingExportFile));
                     OutputStream rawOut = openBackupOutputStream(data.getData());
                     BufferedOutputStream out = rawOut == null ? null : new BufferedOutputStream(rawOut)) {
                    if (out == null) throw new IllegalStateException("Unable to open destination file.");
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    out.flush();
                    Toast.makeText(this, "Backup saved.", Toast.LENGTH_SHORT).show();
                } catch (Exception error) {
                    Toast.makeText(this, "Backup could not be saved.", Toast.LENGTH_LONG).show();
                }
            }
            clearExportState(true);
        } else if (requestCode == SAVE_IMAGE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingImageFile != null) {
                try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(pendingImageFile));
                     OutputStream rawOut = getContentResolver().openOutputStream(data.getData(), "w");
                     BufferedOutputStream out = rawOut == null ? null : new BufferedOutputStream(rawOut)) {
                    if (out == null) throw new IllegalStateException("Unable to open destination file.");
                    byte[] buffer = new byte[64 * 1024]; int read;
                    while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                    out.flush(); Toast.makeText(this, "Map thumbnail saved.", Toast.LENGTH_SHORT).show();
                } catch (Exception error) { Toast.makeText(this, "Map thumbnail could not be saved.", Toast.LENGTH_LONG).show(); }
            }
            if (pendingImageFile != null) pendingImageFile.delete();
            pendingImageFile = null; pendingImageName = null;
        }
    }

    @Override
    protected void onDestroy() {
        clearExportState(true);
        if (pendingImageFile != null) pendingImageFile.delete();
        closeImportReader();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
