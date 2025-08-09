# 🚀 Setup GitHub Actions - Auto Attendance Berjalan Terus

## 📋 Langkah-langkah Setup

### 1. ✅ Repository sudah siap
- Repository: `https://github.com/kgswhy/autoabses`
- File-file sudah ter-push dengan benar

### 2. 🔐 Setup Repository Secrets

Buka link ini: `https://github.com/kgswhy/autoabses/settings/secrets/actions`

Klik "New repository secret" dan tambahkan 5 secrets ini:

#### Secret 1: UBL_USERNAME
- Name: `UBL_USERNAME`
- Value: `2512510237`

#### Secret 2: UBL_PASSWORD  
- Name: `UBL_PASSWORD`
- Value: `P13032006`

#### Secret 3: COURSE_ID
- Name: `COURSE_ID`
- Value: `29050`

#### Secret 4: TELEGRAM_BOT_TOKEN
- Name: `TELEGRAM_BOT_TOKEN`
- Value: `7950123660:AAFHnzSmAgyNeVLiHfpmBAaitpvE35iFnTk`

#### Secret 5: TELEGRAM_CHAT_ID
- Name: `TELEGRAM_CHAT_ID`
- Value: `1743712356`

### 3. 🎯 Test GitHub Actions

1. Buka: `https://github.com/kgswhy/autoabses/actions`
2. Klik workflow "Auto Attendance UBL"
3. Klik tombol "Run workflow" (biru)
4. Klik "Run workflow" lagi untuk konfirmasi

### 4. 📊 Monitor Hasil

Setelah workflow berjalan:
- ✅ Cek status di tab Actions
- ✅ Cek Telegram untuk notifikasi
- ✅ Lihat logs untuk detail

### 5. ⏰ Schedule Otomatis

Workflow sudah dikonfigurasi untuk berjalan:
- **Setiap jam** (cron: '0 * * * *')
- **Manual trigger** tersedia

## 🔧 Troubleshooting

### Jika workflow gagal:

1. **Cek Secrets:** Pastikan semua 5 secrets sudah benar
2. **Cek Logs:** Lihat detail error di Actions
3. **Test Manual:** Coba trigger manual dulu

### Error yang mungkin muncul:

- **"Telegram not configured"** → Cek bot token & chat ID
- **"Authentication failed"** → Cek UBL username/password  
- **"Course not found"** → Cek course ID

## 📱 Monitoring

### GitHub Actions:
- Buka: `https://github.com/kgswhy/autoabses/actions`
- Lihat history runs
- Cek logs setiap run

### Telegram:
- Bot akan kirim notifikasi setiap check
- Format: ✅/ℹ️/⚠️/❌ sesuai hasil

## 🎯 Hasil yang Diharapkan

- ✅ Script berjalan setiap jam otomatis
- ✅ Notifikasi Telegram setiap check
- ✅ Log lengkap di GitHub Actions
- ✅ Tidak ada sesi = normal (akan terus monitor)

## 🚀 Next Steps

1. **Setup secrets** (langkah 2 di atas)
2. **Test manual** (langkah 3 di atas)  
3. **Monitor** beberapa jam pertama
4. **Adjust schedule** jika perlu (ubah cron di workflow)

## 📞 Support

Jika ada masalah:
1. Cek logs di GitHub Actions
2. Cek notifikasi Telegram
3. Pastikan semua secrets benar 