package com.imagematcher.app;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.util.DisplayMetrics;
import android.view.*;
import android.widget.*;
import java.nio.ByteBuffer;

public class LiveMatcherService extends Service {
    public static final String ACTION_START="com.imagematcher.app.START_LIVE";
    public static final String ACTION_STOP="com.imagematcher.app.STOP_LIVE";
    private static final String CHANNEL="live_matcher";
    private WindowManager wm;
    private View bubble, preview;
    private ImageView previewImage;
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader reader;
    private volatile boolean captureRequested=false;
    private int width,height,density;

    @Override public void onCreate(){ super.onCreate(); createChannel(); }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null && ACTION_STOP.equals(intent.getAction())){ stopSelf(); return START_NOT_STICKY; }
        startForeground(4107, notification());
        if(intent==null) return START_NOT_STICKY;
        int resultCode=intent.getIntExtra("resultCode", Activity.RESULT_CANCELED);
        Intent data;
        if(Build.VERSION.SDK_INT>=33) data=intent.getParcelableExtra("resultData",Intent.class); else data=intent.getParcelableExtra("resultData");
        if(resultCode==Activity.RESULT_OK && data!=null && projection==null) startProjection(resultCode,data);
        return START_NOT_STICKY;
    }

    private void createChannel(){
        if(Build.VERSION.SDK_INT>=26){ NotificationChannel c=new NotificationChannel(CHANNEL,"Live Matcher","".isEmpty()?NotificationManager.IMPORTANCE_LOW:NotificationManager.IMPORTANCE_LOW); c.setDescription("Screen capture for on-demand Image Matcher scanning"); getSystemService(NotificationManager.class).createNotificationChannel(c); }
    }
    private Notification notification(){
        Intent stop=new Intent(this,LiveMatcherService.class).setAction(ACTION_STOP);
        PendingIntent pi=PendingIntent.getService(this,1,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_camera).setContentTitle("Image Matcher Live").setContentText("Tap the floating button to scan on demand").setOngoing(true).addAction(new Notification.Action.Builder(null,"Stop",pi).build()).build();
    }

    private void startProjection(int code,Intent data){
        wm=(WindowManager)getSystemService(WINDOW_SERVICE);
        WindowManager defaultWm=wm;
        DisplayMetrics dm=new DisplayMetrics();
        if(Build.VERSION.SDK_INT>=30){ Rect b=wm.getCurrentWindowMetrics().getBounds(); width=b.width(); height=b.height(); density=getResources().getDisplayMetrics().densityDpi; }
        else { getSystemService(WindowManager.class).getDefaultDisplay().getRealMetrics(dm); width=dm.widthPixels; height=dm.heightPixels; density=dm.densityDpi; }
        MediaProjectionManager mpm=(MediaProjectionManager)getSystemService(MEDIA_PROJECTION_SERVICE);
        projection=mpm.getMediaProjection(code,data);
        projection.registerCallback(new MediaProjection.Callback(){ @Override public void onStop(){ stopSelf(); } },new Handler(Looper.getMainLooper()));
        reader=ImageReader.newInstance(width,height,PixelFormat.RGBA_8888,3);
        reader.setOnImageAvailableListener(r->{
            Image image=null;
            try{
                image=r.acquireLatestImage(); if(image==null) return;
                if(captureRequested){ captureRequested=false; Bitmap b=imageToBitmap(image); new Handler(Looper.getMainLooper()).post(()->showPreview(b)); }
            }catch(Exception ignored){} finally{ if(image!=null) image.close(); }
        },new Handler(Looper.getMainLooper()));
        virtualDisplay=projection.createVirtualDisplay("ImageMatcherLive",width,height,density,DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,reader.getSurface(),null,null);
        showBubble();
    }

    private Bitmap imageToBitmap(Image image){
        Image.Plane p=image.getPlanes()[0]; ByteBuffer buf=p.getBuffer(); int pixelStride=p.getPixelStride(), rowStride=p.getRowStride(); int rowPadding=rowStride-pixelStride*width;
        Bitmap padded=Bitmap.createBitmap(width+rowPadding/pixelStride,height,Bitmap.Config.ARGB_8888); padded.copyPixelsFromBuffer(buf);
        Bitmap out=Bitmap.createBitmap(padded,0,0,width,height); if(out!=padded) padded.recycle(); return out;
    }

    private int overlayType(){ return Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE; }
    private WindowManager.LayoutParams bubbleParams(){
        WindowManager.LayoutParams lp=new WindowManager.LayoutParams(dp(58),dp(58),overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,PixelFormat.TRANSLUCENT); lp.gravity=Gravity.TOP|Gravity.START; lp.x=20; lp.y=220; return lp;
    }
    private void showBubble(){
        if(bubble!=null) return;
        TextView b=new TextView(this); b.setText("SCAN"); b.setTextColor(Color.WHITE); b.setTextSize(11); b.setGravity(Gravity.CENTER); GradientDrawable bg=new GradientDrawable(); bg.setColor(Color.argb(225,20,24,35)); bg.setShape(GradientDrawable.OVAL); bg.setStroke(dp(2),Color.WHITE); b.setBackground(bg);
        WindowManager.LayoutParams lp=bubbleParams(); final int[] down={0,0,0,0}; final boolean[] moved={false};
        b.setOnTouchListener((v,e)->{ switch(e.getAction()){
            case MotionEvent.ACTION_DOWN: down[0]=lp.x;down[1]=lp.y;down[2]=(int)e.getRawX();down[3]=(int)e.getRawY();moved[0]=false;return true;
            case MotionEvent.ACTION_MOVE: int dx=(int)e.getRawX()-down[2],dy=(int)e.getRawY()-down[3]; if(Math.abs(dx)+Math.abs(dy)>12)moved[0]=true; lp.x=down[0]+dx;lp.y=down[1]+dy;wm.updateViewLayout(v,lp);return true;
            case MotionEvent.ACTION_UP: if(!moved[0]) requestCapture();return true; } return false; });
        bubble=b; wm.addView(b,lp);
    }
    private void requestCapture(){ if(bubble!=null) bubble.setVisibility(View.INVISIBLE); if(preview!=null) preview.setVisibility(View.GONE); new Handler(Looper.getMainLooper()).postDelayed(()->captureRequested=true,180); }

    private void showPreview(Bitmap bitmap){
        if(bitmap==null){ if(bubble!=null)bubble.setVisibility(View.VISIBLE);return; }
        if(preview!=null){ try{wm.removeView(preview);}catch(Exception ignored){} preview=null; }
        LinearLayout box=new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(8),dp(8),dp(8),dp(8)); GradientDrawable bg=new GradientDrawable(); bg.setColor(Color.argb(245,18,22,31)); bg.setCornerRadius(dp(14)); bg.setStroke(dp(1),Color.LTGRAY); box.setBackground(bg);
        TextView title=new TextView(this); title.setText("Live Matcher • Phase 1 capture"); title.setTextColor(Color.WHITE); title.setTextSize(13); title.setPadding(0,0,0,dp(6));
        previewImage=new ImageView(this); previewImage.setImageBitmap(bitmap); previewImage.setAdjustViewBounds(true); previewImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout actions=new LinearLayout(this); actions.setGravity(Gravity.END);
        Button again=new Button(this); again.setText("Scan Again"); again.setOnClickListener(v->requestCapture()); Button close=new Button(this); close.setText("Close"); close.setOnClickListener(v->{ if(preview!=null)preview.setVisibility(View.GONE); if(bubble!=null)bubble.setVisibility(View.VISIBLE); }); actions.addView(again);actions.addView(close);
        box.addView(title); box.addView(previewImage,new LinearLayout.LayoutParams(dp(300),dp(430))); box.addView(actions); preview=box;
        WindowManager.LayoutParams lp=new WindowManager.LayoutParams(dp(320),WindowManager.LayoutParams.WRAP_CONTENT,overlayType(),WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,PixelFormat.TRANSLUCENT); lp.gravity=Gravity.CENTER;
        wm.addView(box,lp); if(bubble!=null)bubble.setVisibility(View.VISIBLE);
    }
    private int dp(int v){ return Math.round(v*getResources().getDisplayMetrics().density); }

    @Override public void onDestroy(){
        try{if(bubble!=null&&wm!=null)wm.removeView(bubble);}catch(Exception ignored){} try{if(preview!=null&&wm!=null)wm.removeView(preview);}catch(Exception ignored){}
        if(virtualDisplay!=null)virtualDisplay.release(); if(reader!=null)reader.close(); if(projection!=null)projection.stop(); bubble=null;preview=null; super.onDestroy();
    }
    @Override public android.os.IBinder onBind(Intent intent){ return null; }
}
