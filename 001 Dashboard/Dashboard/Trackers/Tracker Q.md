---
icon: lucide-form-input
hidely: true
---
```dataviewjs
// كود متقدم لتتبع صفحات القرآن - مع منع التكرار لمدة ساعتين

const currentFile = app.workspace.getActiveFile();
if (!currentFile) {
    return;
}

// استخراج تاريخ اليوم
const todayMatch = currentFile.name.match(/(\d{4}-\d{2}-\d{2})/);
if (!todayMatch) {
    new Notice('❌ اسم الملف لا يحتوي على تاريخ صحيح');
    return;
}
const todayDate = todayMatch[1];

// ===== التحقق من آخر وقت إدخال =====
const LAST_INPUT_KEY = `[[quran]]-pages-last-input-${currentFile.path}`;
const COOLDOWN_HOURS = 2; // ساعتان
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

// التحقق من وجود إدخال سابق خلال ساعتين
const lastInputTime = localStorage.getItem(LAST_INPUT_KEY);
if (lastInputTime) {
    const timeSinceLastInput = Date.now() - parseInt(lastInputTime);
    const hoursSinceLastInput = (timeSinceLastInput / (1000 * 60 * 60)).toFixed(1);
    
    if (timeSinceLastInput < COOLDOWN_MS) {
        // إظهار رسالة في الكونسول فقط (بدون نافذة)
        console.log(`⏳ تم إدخال قراءة قبل ${hoursSinceLastInput} ساعة. سيتم إعادة الفتح بعد ${(COOLDOWN_MS - timeSinceLastInput) / (1000 * 60 * 60)} ساعات.`);
        return;
    }
}

// التحقق مما إذا كان اليوم قد تم إدخال قراءة بالفعل
const fileCache = app.metadataCache.getFileCache(currentFile);
if (fileCache?.frontmatter?.["Number of Pages (reading)"] !== undefined) {
    // هناك قراءة مسجلة لهذا اليوم، نتحقق متى تم الإدخال
    if (lastInputTime) {
        const timeSinceLastInput = Date.now() - parseInt(lastInputTime);
        if (timeSinceLastInput < COOLDOWN_MS) {
            console.log(`📖 تم تسجيل قراءة اليوم (${fileCache.frontmatter["Number of Pages (reading)"]} صفحات)`);
            return;
        }
    } else {
        // لا يوجد وقت سابق، ولكن هناك قراءة مسجلة - نسمح بالإدخال
        console.log('تم تسجيل قراءة سابقة، ولكن لا يوجد وقت مرجعي - سيتم فتح النافذة');
    }
}

// جلب مجموع الصفحات السابقة هذا الشهر
const monthStart = moment(todayDate).startOf('year').format('YYYY-MM-DD');
const monthEnd = moment(todayDate).endOf('year').format('YYYY-MM-DD');

let totalPagesThisMonth = 0;
const allDailyFiles = app.vault.getMarkdownFiles()
    .filter(f => f.path.includes('003 Daily/001 Active Diaries'))
    .filter(f => {
        const fileDateMatch = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        //if (!fileDateMatch) return false;
        //return fileDateMatch[1] >= monthStart && fileDateMatch[1] <= monthEnd;
    });

for (const file of allDailyFiles) {
    if (file.path === currentFile.path) continue;
    const cache = app.metadataCache.getFileCache(file);
    totalPagesThisMonth += cache?.frontmatter?.["Number of Pages (reading)"] || 0;
}

// ===== نافذة منبثقة جميلة =====
const modalHtml = `
<div class="modal-container" style="direction: rtl;position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 1000; background-color: rgba(0, 0, 0, 0.5);">
    <div class="modal" style="background-color: var(--background-primary); border-radius: 16px; padding: 20px; width: 320px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2); border: 1px solid var(--background-modifier-border);">
        <h3 style="margin-top: 0; margin-bottom: 15px; color: var(--text-normal); font-size: 18px;">إلى أين وصلت في تلاوة القرآن؟</h3>
        
        
        <input type="number" id="modal-page-input" style="direction: right; width: 100%; padding: 10px; border-radius: 12px; border: 1px solid var(--background-modifier-border); background-color: var(--background-secondary); color: var(--text-normal); font-size: 16px; box-sizing: border-box; margin-bottom: 15px;" placeholder="رقم الصفحة التي وصلت إليها" autofocus>
        
        <div style="display: flex; gap: 10px;">
            <button id="modal-submit" style="flex: 2; padding: 10px; border-radius: 12px; border: none; background-color: var(--interactive-accent); color: var(--text-on-accent); font-size: 14px; cursor: pointer;">حفظ</button>
            <button id="modal-cancel" style="flex: 1; padding: 10px; border-radius: 12px; border: 1px solid var(--background-modifier-border); background-color: transparent; color: var(--text-muted); font-size: 14px; cursor: pointer;">إلغاء</button>
        </div>
    </div>
</div>
`;

// إنشاء وإضافة النافذة إلى الصفحة
const modalDiv = document.createElement('div');
modalDiv.innerHTML = modalHtml;
document.body.appendChild(modalDiv);

// التركيز على حقل الإدخال
const input = modalDiv.querySelector('#modal-page-input');
input.focus();

// معالج زر الإلغاء
modalDiv.querySelector('#modal-cancel').addEventListener('click', () => {
    modalDiv.remove();
});

// معالج زر الحفظ
modalDiv.querySelector('#modal-submit').addEventListener('click', async () => {
    const pageNum = parseInt(input.value);
    modalDiv.remove();
    
    if (isNaN(pageNum) || pageNum < 0) {
        new Notice('❌ الرجاء إدخال رقم صحيح');
        return;
    }
    
    const todayPages = pageNum - totalPagesThisMonth;
    if (todayPages < 0) {
        new Notice('⚠️ رقم الصفحة أقل من المجموع السابق');
        return;
    }
    
    if (todayPages === 0 && !confirm('⚠️ لم تقرأ أي صفحات اليوم. هل أنت متأكد؟')) {
        return;
    }
    
    // حفظ النتيجة
    await app.fileManager.processFrontMatter(currentFile, (fm) => {
        fm["Number of Pages (reading)"] = todayPages;
    });
    
    // تسجيل وقت الإدخال
    localStorage.setItem(LAST_INPUT_KEY, Date.now().toString());
    
    new Notice(`✓ تم تسجيل ${todayPages} صفحة`);
});

// معالج الضغط على Enter في حقل الإدخال
input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        modalDiv.querySelector('#modal-submit').click();
    }
});
```