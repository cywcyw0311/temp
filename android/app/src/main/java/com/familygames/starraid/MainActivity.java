package com.familygames.starraid;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.DisplayCutout;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/**
 * 星际突击：全屏 WebView 外壳。
 * - 画面铺满整个屏幕（包括刘海 / 挖孔区域），隐藏状态栏和导航栏，上下不留黑边；
 * - 把刘海 / 挖孔的安全区尺寸传给网页，分数、暂停按钮等界面会自动避开摄像头；
 * - 返回键：游戏中 = 暂停，菜单里 = 返回上一层，登录界面连按两次 = 退出；
 * - 切到后台自动暂停。
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/index.html";
    private WebView web;
    private long lastBack;
    private int insetTop, insetRight, insetBottom, insetLeft;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        if (Build.VERSION.SDK_INT < 35) {
            w.setStatusBarColor(Color.TRANSPARENT);
            w.setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        setVolumeControlStream(AudioManager.STREAM_MUSIC);   // 音量键调节游戏音量

        web = new WebView(this);
        web.setBackgroundColor(0xFF04050F);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(false);
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);   // 长按不弹出复制菜单（长按 A 键是锁定连发）

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // 高分榜、难度等保存在 localStorage
        s.setMediaPlaybackRequiresUserGesture(false); // 音效
        s.setTextZoom(100);                           // 不受手机“字体大小”设置影响，界面不会错位
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith("file:///android_asset/");   // 只允许打开游戏自己的页面
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushInsets();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recreate();   // 网页进程意外退出时重新打开，而不是整个 App 闪退
                return true;
            }
        });

        web.setOnApplyWindowInsetsListener((v, insets) -> {
            readCutout(insets);
            pushInsets();
            return v.onApplyWindowInsets(insets);
        });

        setContentView(web);
        hideSystemBars();
        web.loadUrl(START_URL);
    }

    /** 刘海 / 挖孔的安全区（状态栏和导航栏已隐藏，只需要避开摄像头） */
    private void readCutout(WindowInsets insets) {
        int t = 0, r = 0, b = 0, l = 0;
        if (Build.VERSION.SDK_INT >= 30) {
            Insets c = insets.getInsets(WindowInsets.Type.displayCutout());
            t = c.top; r = c.right; b = c.bottom; l = c.left;
        } else if (Build.VERSION.SDK_INT >= 28) {
            DisplayCutout c = insets.getDisplayCutout();
            if (c != null) { t = c.getSafeInsetTop(); r = c.getSafeInsetRight(); b = c.getSafeInsetBottom(); l = c.getSafeInsetLeft(); }
        }
        insetTop = t; insetRight = r; insetBottom = b; insetLeft = l;
    }

    private void pushInsets() {
        if (web == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(java.util.Locale.US,
                "window.__appInsets&&window.__appInsets(%.1f,%.1f,%.1f,%.1f)",
                insetTop / d, insetRight / d, insetBottom / d, insetLeft / d);
        web.evaluateJavascript(js, null);
    }

    /** 沉浸式全屏：隐藏状态栏和导航栏，从屏幕边缘滑动可以临时呼出 */
    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("window.__appBack?window.__appBack():'exit'", v -> {
            if (v == null || !v.contains("exit")) return;
            long now = SystemClock.uptimeMillis();
            if (now - lastBack < 2000) finish();
            else {
                lastBack = now;
                Toast.makeText(this, R.string.press_again, Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.__appPause&&window.__appPause()", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
