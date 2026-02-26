---
banner: https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT04Qfg17fYOhAm0JdPEKF75zJAlvXtBwENt_MzslXpSw&s=10
icon: lucide-line-chart
cssclasses:
  - card
  - dashboard
links pages:
  - "[[Tracker B]]"
---
# Tracker Read Quran 
```dataviewjs
// بيانات أيام قراءة القرآن
let container = dv.el("div", "");
container.className = "tracker-dashboard";
const folder = '"003 Daily"';
const pages = dv.pages(folder).where(p => p["Read Quran"] != null);

// تجميع البيانات
let data = {};
pages.forEach(page => {
    let date = page.file.name; // اسم الملف هو التاريخ
    let value = page["Read Quran"] === true ? 1 : 0;
    data[date] = value;
});

// CSS للعرض
container.innerHTML = `
<style>
    .quran-month-view {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        background: var(--background-primary);
        border-radius: 8px;
    }
    .quran-month-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: steelblue;
        font-weight: bold;
        font-size: 1.2em;
    }
    .quran-weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        text-align: center;
        color: var(--text-muted);
        font-size: 0.8em;
    }
    .quran-days-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 5px;
    }
    .quran-day {
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--background-secondary);
        border-radius: 50%;
        font-size: 0.8em;
        position: relative;
    }
    .quran-day.read {
        background: steelblue;
        color: white;
    }
    .quran-day.read::after {
        content: "✓";
        position: absolute;
        top: -5px;
        right: -5px;
        background: steelblue;
        color: white;
        border-radius: 50%;
        width: 15px;
        height: 15px;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .quran-day.out-of-month {
        opacity: 0.3;
    }
</style>
`;

// الحصول على الشهر الحالي
let today = dv.date("today");
let monthStart = today.startOf("month");
let monthEnd = today.endOf("month");
let startDay = monthStart.startOf("week"); // يبدأ من الأحد

let weeks = [];
let currentDay = startDay;

while (currentDay <= monthEnd || weeks.length < 6) {
    let week = [];
    for (let i = 0; i < 7; i++) {
        week.push(currentDay);
        currentDay = currentDay.plus({ days: 1 });
    }
    weeks.push(week);
}

let monthDiv = container.createDiv({ cls: "quran-month-view" });

// عنوان الشهر
let header = monthDiv.createDiv({ cls: "quran-month-header" });
header.innerHTML = `
    <span>←</span>
    <span>${today.toFormat("MMMM yyyy")}</span>
    <span>→</span>
`;

// أيام الأسبوع
let weekdays = monthDiv.createDiv({ cls: "quran-weekdays" });
["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {
    weekdays.createSpan({ text: day });
});

// أيام الشهر
let grid = monthDiv.createDiv({ cls: "quran-days-grid" });

weeks.forEach(week => {
    week.forEach(date => {
        let dateStr = date.toFormat("yyyy-MM-dd");
        let isInMonth = date.month === today.month;
        let isRead = data[dateStr] === 1;
        
        let dayDiv = grid.createDiv({ 
            cls: `quran-day ${isRead ? "read" : ""} ${!isInMonth ? "out-of-month" : ""}`,
            text: date.day.toString()
        });
        
        if (isRead) {
            dayDiv.setAttribute("title", `قرأت القرآن في ${date.toFormat("yyyy-MM-dd")}`);
        }
    });
});
```
```dataviewjs
// بيانات عدد الصفحات
const folder = '"003 Daily/001 Active Diaries"';
const pages = dv.pages(folder)
    .where(p => p["The number of pages you finished reading from the Quran"] != null)
    .sort(p => p.file.name);

// تجميع البيانات
let dates = [];
let values = [];

pages.forEach(page => {
    dates.push(page.file.name);
    values.push(page["The number of pages you finished reading from the Quran"]);
});

// إنشاء الحاوية الرئيسية
let container = dv.el("div", "");
container.className = "tracker-dashboard";
container.innerHTML = `
<style>
    .quran-chart-container {
        padding: 15px;
        background: var(--background-primary);
        border-radius: 8px;
        direction: rtl;
    }
    .quran-chart-title {
        text-align: center;
        color: var(--text-normal);
        font-weight: bold;
        margin-bottom: 15px;
    }
    .quran-dots-container {
        position: relative;
        height: 220px;
        margin: 10px 0;
        border-bottom: 1px solid var(--background-modifier-border);
        border-left: 1px solid var(--background-modifier-border);
    }
    .quran-dots-grid {
        position: relative;
        width: 100%;
        height: 100%;
    }
    .quran-line-connector {
        position: absolute;
        height: 2px;
        background: steelblue;
        transform-origin: 0 0;
        z-index: 1;
        opacity: 0.6;
        box-shadow: 0 1px 3px rgba(70, 130, 180, 0.3);
        pointer-events: none;
    }
    .quran-dot {
        position: absolute;
        width: 8px;
        height: 8px;
        background: steelblue;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 0 5px rgba(70, 130, 180, 0.5);
        z-index: 2;
    }
    .quran-dot:hover {
        width: 12px;
        height: 12px;
        background: #ff6b6b;
        box-shadow: 0 0 10px rgba(255, 107, 107, 0.8);
        z-index: 100;
    }
    .quran-dot:hover::after {
        content: attr(data-date) ": " attr(data-value) " صفحة";
        position: absolute;
        top: -30px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--background-secondary);
        color: var(--text-normal);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 101;
    }
    .quran-axis-y {
        position: absolute;
        left: -30px;
        top: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        color: var(--text-muted);
        font-size: 10px;
    }
    .quran-axis-x {
        display: flex;
        justify-content: space-between;
        margin-top: 5px;
        color: var(--text-muted);
        font-size: 10px;
        padding-right: 20px;
    }
    .quran-line {
        position: absolute;
        height: 1px;
        background: var(--background-modifier-border);
        width: 100%;
        pointer-events: none;
    }
    .quran-stats {
        display: flex;
        justify-content: space-around;
        margin-top: 15px;
        padding-top: 10px;
        border-top: 1px solid var(--background-modifier-border);
    }
    .quran-stat-item {
        text-align: center;
    }
    .quran-stat-value {
        font-weight: bold;
        color: steelblue;
        font-size: 1.2em;
    }
    .quran-stat-label {
        font-size: 0.8em;
        color: var(--text-muted);
    }
</style>
`;

let chartDiv = container.createDiv({ cls: "quran-chart-container" });

// العنوان
chartDiv.createDiv({ 
    cls: "quran-chart-title",
    text: "مخطط عدد الصفحات التي أقرأها يوميا من القرآن"
});

// حاوية النقاط
let dotsContainer = chartDiv.createDiv({ cls: "quran-dots-container" });

// خطوط الشبكة الأفقية (قيم Y)
let maxValue = Math.max(...values, 1);
for (let i = 0; i <= 5; i++) {
    let yLine = dotsContainer.createDiv({ 
        cls: "quran-line",
        attr: { style: `top: ${(i/5) * 100}%;` }
    });
}

// محور Y
let yAxis = dotsContainer.createDiv({ cls: "quran-axis-y" });
for (let i = 5; i >= 0; i--) {
    let value = Math.round((i/5) * maxValue);
    yAxis.createSpan({ text: value.toString() });
}

// شبكة النقاط (ستحتوي على الخطوط والنقاط)
let grid = dotsContainer.createDiv({ cls: "quran-dots-grid" });

// حساب المواقع النسبية للنقاط (كنسب مئوية)
let points = [];
let minDate = dates.length > 0 ? new Date(dates[0]) : new Date();
let maxDate = dates.length > 0 ? new Date(dates[dates.length - 1]) : new Date();
let timeRange = maxDate - minDate || 1;

values.forEach((val, i) => {
    let date = new Date(dates[i]);
    let xPercent = ((date - minDate) / timeRange) * 100; // نسبة أفقية من 0 إلى 100
    let yPercent = 100 - (val / maxValue) * 100; // نسبة رأسية (0 في الأعلى، 100 في الأسفل)
    
    points.push({ x: xPercent, y: yPercent, val, date: dates[i] });
});

// دالة لرسم الخطوط والنقاط بعد حساب الأبعاد الفعلية بالبكسل
function renderChart() {
    // أبعاد الحاوية
    const rect = dotsContainer.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // تنظيف الشبكة
    grid.innerHTML = '';

    // تحويل النقاط إلى إحداثيات بكسل داخل grid
    const pixelPoints = points.map(p => ({
        x: (p.x / 100) * width,
        y: (p.y / 100) * height,
        val: p.val,
        date: p.date
    }));

    // رسم الخطوط أولاً (بحيث تكون خلف النقاط)
    for (let i = 0; i < pixelPoints.length - 1; i++) {
        const p1 = pixelPoints[i];
        const p2 = pixelPoints[i + 1];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y; // dy موجب إذا كانت p2 أسفل p1 (لأن y تزيد للأسفل)
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI; // الزاوية بالدرجات

        const line = document.createElement('div');
        line.className = 'quran-line-connector';
        line.style.cssText = `
            left: ${p1.x}px;
            top: ${p1.y}px;
            width: ${distance}px;
            transform: rotate(${angle}deg);
        `;
        grid.appendChild(line);
    }

    // رسم النقاط
    pixelPoints.forEach(p => {
        const dot = document.createElement('div');
        dot.className = 'quran-dot';
        dot.style.cssText = `
            left: ${p.x}px;
            top: ${p.y}px;
        `;
        dot.setAttribute('data-value', p.val);
        dot.setAttribute('data-date', p.date);
        grid.appendChild(dot);
    });
}

// ننتظر حتى يتم إدراج العناصر في DOM ثم نرسم
// استخدام requestAnimationFrame للتأكد من اكتمال التخطيط
requestAnimationFrame(() => {
    renderChart();
});

// إعادة الرسم عند تغيير حجم النافذة (اختياري)
window.addEventListener('resize', () => {
    renderChart();
});

// محور X (نص عادي)
let xAxis = chartDiv.createDiv({ cls: "quran-axis-x" });
if (dates.length > 0) {
    xAxis.createSpan({ text: dates[0] });
    if (dates.length > 2) {
        xAxis.createSpan({ text: dates[Math.floor(dates.length / 2)] });
    }
    xAxis.createSpan({ text: dates[dates.length - 1] });
}

// الإحصائيات
let max = Math.max(...values);
let min = Math.min(...values);
let sum = values.reduce((a, b) => a + b, 0);
let avg = (sum / values.length).toFixed(1);

let stats = chartDiv.createDiv({ cls: "quran-stats" });

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${max}</div>
    <div class="quran-stat-label">أقصى عدد</div>
`});

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${avg}</div>
    <div class="quran-stat-label">المتوسط</div>
`});

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${min}</div>
    <div class="quran-stat-label">أصغر عدد</div>
`});

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${sum}</div>
    <div class="quran-stat-label">المجموع</div>
`});
```
```dataviewjs
// بيانات هذا الشهر
const folder = '"003 Daily/001 Active Diaries"';
let today = dv.date("today");
let monthStart = today.startOf("month");
let monthEnd = today.endOf("month");

let pages = dv.pages(folder)
    .where(p => p["The number of pages you finished reading from the Quran"] != null &&
                p.file.name >= monthStart.toFormat("yyyy-MM-dd") &&
                p.file.name <= monthEnd.toFormat("yyyy-MM-dd"));

let total = 0;
pages.forEach(page => {
    total += page["The number of pages you finished reading from the Quran"] || 0;
});

let target = 604; // عدد صفحات القرآن

// إنشاء Bullet Chart
let container = dv.el("div", "");
container.className = "tracker-dashboard";
container.innerHTML = `
<style>
    .quran-bullet-container {
        padding: 15px;
        background: var(--background-primary);
        border-radius: 8px;
        font-family: var(--font-interface);
    }
    .quran-bullet-title {
        text-align: center;
        color: var(--text-normal);
        font-weight: bold;
        margin-bottom: 15px;
    }
    .quran-bullet-chart {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .quran-bullet-value {
        display: flex;
        justify-content: space-between;
        color: var(--text-muted);
        font-size: 0.9em;
    }
    .quran-bullet-bar-container {
        position: relative;
        height: 30px;
        background: #17202A;
        border-radius: 4px;
        overflow: hidden;
    }
    .quran-bullet-bar {
        height: 100%;
        background: steelblue;
        width: ${(total / target) * 100}%;
        transition: width 0.3s;
    }
    .quran-bullet-marker {
        position: absolute;
        top: 0;
        left: ${(1 / target) * 100}%;
        width: 2px;
        height: 100%;
        background: white;
    }
    .quran-bullet-stats {
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
        color: var(--text-normal);
    }
    .quran-bullet-stat {
        text-align: center;
    }
    .quran-bullet-stat-value {
        font-weight: bold;
        color: steelblue;
        font-size: 1.2em;
    }
    .quran-bullet-stat-label {
        font-size: 0.8em;
        color: var(--text-muted);
    }
</style>
`;

let bulletDiv = container.createDiv({ cls: "quran-bullet-container" });

// العنوان
bulletDiv.createDiv({ 
    cls: "quran-bullet-title",
    text: "عدد الصفحات التي قرأتها من القرآن هذا الشهر"
});

let chart = bulletDiv.createDiv({ cls: "quran-bullet-chart" });

// القيمة الحالية والهدف
let valueDiv = chart.createDiv({ cls: "quran-bullet-value" });
valueDiv.createSpan({ text: `المجموع: ${total} صفحة` });
valueDiv.createSpan({ text: `الهدف: ${target} صفحة` });

// شريط التقدم
let barContainer = chart.createDiv({ cls: "quran-bullet-bar-container" });
barContainer.createDiv({ cls: "quran-bullet-bar" });

if (total < target) {
    barContainer.createDiv({ cls: "quran-bullet-marker" });
}

// إحصائيات إضافية
let stats = bulletDiv.createDiv({ cls: "quran-bullet-stats" });
let remaining = Math.max(0, target - total);
let percentage = ((total / target) * 100).toFixed(1);

stats.createDiv({ cls: "quran-bullet-stat", html: `
    <div class="quran-bullet-stat-value">${remaining}</div>
    <div class="quran-bullet-stat-label">المتبقي</div>
`});

stats.createDiv({ cls: "quran-bullet-stat", html: `
    <div class="quran-bullet-stat-value">${percentage}%</div>
    <div class="quran-bullet-stat-label">الإنجاز</div>
`});
```

# Tracker Memorizing the Quran

```dataviewjs
// بيانات أيام قراءة القرآن
const folder = '"003 Daily"';
const pages = dv.pages(folder).where(p => p["Memorizing the Quran"] != null);

// تجميع البيانات
let data = {};
pages.forEach(page => {
    let date = page.file.name; // اسم الملف هو التاريخ
    let value = page["Memorizing the Quran"] === true ? 1 : 0;
    data[date] = value;
});

// إنشاء عنصر HTML للعرض
let container = dv.el("div", "");
container.className = "tracker-dashboard";
// CSS للعرض
container.innerHTML = `
<style>
    .quran-month-view {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 10px;
        background: var(--background-primary);
        border-radius: 8px;
    }
    .quran-month-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: steelblue;
        font-weight: bold;
        font-size: 1.2em;
    }
    .quran-weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        text-align: center;
        color: var(--text-muted);
        font-size: 0.8em;
    }
    .quran-days-grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 5px;
    }
    .quran-day {
        aspect-ratio: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--background-secondary);
        border-radius: 50%;
        font-size: 0.8em;
        position: relative;
    }
    .quran-day.read {
        background: steelblue;
        color: white;
    }
    .quran-day.read::after {
        content: "✓";
        position: absolute;
        top: -5px;
        right: -5px;
        background: steelblue;
        color: white;
        border-radius: 50%;
        width: 15px;
        height: 15px;
        font-size: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .quran-day.out-of-month {
        opacity: 0.3;
    }
</style>
`;

// الحصول على الشهر الحالي
let today = dv.date("today");
let monthStart = today.startOf("month");
let monthEnd = today.endOf("month");
let startDay = monthStart.startOf("week"); // يبدأ من الأحد

let weeks = [];
let currentDay = startDay;

while (currentDay <= monthEnd || weeks.length < 6) {
    let week = [];
    for (let i = 0; i < 7; i++) {
        week.push(currentDay);
        currentDay = currentDay.plus({ days: 1 });
    }
    weeks.push(week);
}

let monthDiv = container.createDiv({ cls: "quran-month-view" });

// عنوان الشهر
let header = monthDiv.createDiv({ cls: "quran-month-header" });
header.innerHTML = `
    <span>←</span>
    <span>${today.toFormat("MMMM yyyy")}</span>
    <span>→</span>
`;

// أيام الأسبوع
let weekdays = monthDiv.createDiv({ cls: "quran-weekdays" });
["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(day => {
    weekdays.createSpan({ text: day });
});

// أيام الشهر
let grid = monthDiv.createDiv({ cls: "quran-days-grid" });

weeks.forEach(week => {
    week.forEach(date => {
        let dateStr = date.toFormat("yyyy-MM-dd");
        let isInMonth = date.month === today.month;
        let isRead = data[dateStr] === 1;
        
        let dayDiv = grid.createDiv({ 
            cls: `quran-day ${isRead ? "read" : ""} ${!isInMonth ? "out-of-month" : ""}`,
            text: date.day.toString()
        });
        
        if (isRead) {
            dayDiv.setAttribute("title", `قرأت القرآن في ${date.toFormat("yyyy-MM-dd")}`);
        }
    });
});
```
```dataviewjs
// بيانات عدد الصفحات
const folder = '"003 Daily/001 Active Diaries"';
const pages = dv.pages(folder)
    .where(p => p["The number of pages you have memorized from the Quran"] != null)
    .sort(p => p.file.name);

// تجميع البيانات
let dates = [];
let values = [];

pages.forEach(page => {
    dates.push(page.file.name);
    values.push(page["The number of pages you have memorized from the Quran"]);
});

// إنشاء الحاوية الرئيسية
let container = dv.el("div", "");
container.className = "tracker-dashboard";
container.innerHTML = `
<style>
    .quran-chart-container {
        padding: 15px;
        background: var(--background-primary);
        border-radius: 8px;
        direction: rtl;
    }
    .quran-chart-title {
        text-align: center;
        color: var(--text-normal);
        font-weight: bold;
        margin-bottom: 15px;
    }
    .quran-dots-container {
        position: relative;
        height: 220px;
        margin: 10px 0;
        border-bottom: 1px solid var(--background-modifier-border);
        border-left: 1px solid var(--background-modifier-border);
    }
    .quran-dots-grid {
        position: relative;
        width: 100%;
        height: 100%;
    }
    .quran-line-connector {
        position: absolute;
        height: 2px;
        background: steelblue;
        transform-origin: 0 0;
        z-index: 1;
        opacity: 0.6;
        box-shadow: 0 1px 3px rgba(70, 130, 180, 0.3);
        pointer-events: none;
    }
    .quran-dot {
        position: absolute;
        width: 8px;
        height: 8px;
        background: steelblue;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 0 5px rgba(70, 130, 180, 0.5);
        z-index: 2;
    }
    .quran-dot:hover {
        width: 12px;
        height: 12px;
        background: #ff6b6b;
        box-shadow: 0 0 10px rgba(255, 107, 107, 0.8);
        z-index: 100;
    }
    .quran-dot:hover::after {
        content: attr(data-date) ": " attr(data-value) " صفحة";
        position: absolute;
        top: -30px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--background-secondary);
        color: var(--text-normal);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 101;
    }
    .quran-axis-y {
        position: absolute;
        left: -40px;
        top: 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        color: var(--text-muted);
        font-size: 10px;
        width: 30px;
        text-align: right;
        z-index: 5;
    }
    .quran-axis-y span {
        background: var(--background-primary);
        padding: 0 2px;
        line-height: 1;
    }
    .quran-axis-x {
        display: flex;
        justify-content: space-between;
        margin-top: 5px;
        color: var(--text-muted);
        font-size: 10px;
        padding-right: 20px;
    }
    .quran-line {
        position: absolute;
        height: 1px;
        background: var(--background-modifier-border);
        width: 100%;
        pointer-events: none;
        z-index: 0;
    }
    .quran-stats {
        display: flex;
        justify-content: space-around;
        margin-top: 15px;
        padding-top: 10px;
        border-top: 1px solid var(--background-modifier-border);
    }
    .quran-stat-item {
        text-align: center;
    }
    .quran-stat-value {
        font-weight: bold;
        color: steelblue;
        font-size: 1.2em;
    }
    .quran-stat-label {
        font-size: 0.8em;
        color: var(--text-muted);
    }
</style>
`;

let chartDiv = container.createDiv({ cls: "quran-chart-container" });

// العنوان
chartDiv.createDiv({ 
    cls: "quran-chart-title",
    text: "مخطط عدد الصفحات التي أقرأها يوميا من القرآن"
});

// حاوية النقاط
let dotsContainer = chartDiv.createDiv({ cls: "quran-dots-container" });

// محور Y (يضاف أولاً ليبقى خلف الشبكة)
let yAxis = dotsContainer.createDiv({ cls: "quran-axis-y" });

// خطوط الشبكة الأفقية (قيم Y)
let maxValue = Math.max(...values, 1);
let steps = 5;
for (let i = 0; i <= steps; i++) {
    let yLine = dotsContainer.createDiv({ 
        cls: "quran-line",
        attr: { style: `top: ${(i/steps) * 100}%;` }
    });
    
    // قيمة النسبة
    let value = Math.round((steps - i) / steps * maxValue);
    yAxis.createSpan({ text: value.toString() });
}

// شبكة النقاط (ستحتوي على الخطوط والنقاط)
let grid = dotsContainer.createDiv({ cls: "quran-dots-grid" });

// حساب المواقع النسبية للنقاط (كنسب مئوية)
let points = [];
let minDate = dates.length > 0 ? new Date(dates[0]) : new Date();
let maxDate = dates.length > 0 ? new Date(dates[dates.length - 1]) : new Date();
let timeRange = maxDate - minDate || 1;

values.forEach((val, i) => {
    let date = new Date(dates[i]);
    let xPercent = ((date - minDate) / timeRange) * 100; // نسبة أفقية من 0 إلى 100
    let yPercent = 100 - (val / maxValue) * 100; // نسبة رأسية (0 في الأعلى، 100 في الأسفل)
    
    points.push({ x: xPercent, y: yPercent, val, date: dates[i] });
});

// دالة لرسم الخطوط والنقاط بعد حساب الأبعاد الفعلية بالبكسل
function renderChart() {
    // أبعاد الحاوية
    const rect = dotsContainer.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // تنظيف الشبكة
    grid.innerHTML = '';

    // تحويل النقاط إلى إحداثيات بكسل داخل grid
    const pixelPoints = points.map(p => ({
        x: (p.x / 100) * width,
        y: (p.y / 100) * height,
        val: p.val,
        date: p.date
    }));

    // رسم الخطوط أولاً (بحيث تكون خلف النقاط)
    for (let i = 0; i < pixelPoints.length - 1; i++) {
        const p1 = pixelPoints[i];
        const p2 = pixelPoints[i + 1];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y; // dy موجب إذا كانت p2 أسفل p1 (لأن y تزيد للأسفل)
        const distance = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI; // الزاوية بالدرجات

        const line = document.createElement('div');
        line.className = 'quran-line-connector';
        line.style.cssText = `
            left: ${p1.x}px;
            top: ${p1.y}px;
            width: ${distance}px;
            transform: rotate(${angle}deg);
        `;
        grid.appendChild(line);
    }

    // رسم النقاط
    pixelPoints.forEach(p => {
        const dot = document.createElement('div');
        dot.className = 'quran-dot';
        dot.style.cssText = `
            left: ${p.x}px;
            top: ${p.y}px;
        `;
        dot.setAttribute('data-value', p.val);
        dot.setAttribute('data-date', p.date);
        grid.appendChild(dot);
    });
}

// ننتظر حتى يتم إدراج العناصر في DOM ثم نرسم
requestAnimationFrame(() => {
    renderChart();
});

// إعادة الرسم عند تغيير حجم النافذة (اختياري)
window.addEventListener('resize', () => {
    renderChart();
});

// محور X (نص عادي)
let xAxis = chartDiv.createDiv({ cls: "quran-axis-x" });
if (dates.length > 0) {
    xAxis.createSpan({ text: dates[0] });
    if (dates.length > 2) {
        xAxis.createSpan({ text: dates[Math.floor(dates.length / 2)] });
    }
    xAxis.createSpan({ text: dates[dates.length - 1] });
}

// الإحصائيات
let max = Math.max(...values);
let min = Math.min(...values);
let sum = values.reduce((a, b) => a + b, 0);
let avg = (sum / values.length).toFixed(1);

let stats = chartDiv.createDiv({ cls: "quran-stats" });

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${max}</div>
    <div class="quran-stat-label">أقصى عدد</div>
`});

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${avg}</div>
    <div class="quran-stat-label">المتوسط</div>
`});

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${min}</div>
    <div class="quran-stat-label">أصغر عدد</div>
`});

stats.createDiv({ cls: "quran-stat-item", html: `
    <div class="quran-stat-value">${sum}</div>
    <div class="quran-stat-label">المجموع</div>
`});
```
```dataviewjs
// بيانات هذا الشهر
const folder = '"003 Daily/001 Active Diaries"';
let today = dv.date("today");
let monthStart = today.startOf("month");
let monthEnd = today.endOf("month");

let pages = dv.pages(folder)
    .where(p => p["The number of pages you have memorized from the Quran"] != null &&
                p.file.name >= monthStart.toFormat("yyyy-MM-dd") &&
                p.file.name <= monthEnd.toFormat("yyyy-MM-dd"));

let total = 0;
pages.forEach(page => {
    total += page["The number of pages you have memorized from the Quran"] || 0;
});

let target = 604; // عدد صفحات القرآن

// إنشاء Bullet Chart
let container = dv.el("div", "");
container.className = "tracker-dashboard";

container.innerHTML = `
<style>
    .quran-bullet-container {
        padding: 15px;
        background: var(--background-primary);
        border-radius: 8px;
        font-family: var(--font-interface);
    }
    .quran-bullet-title {
        text-align: center;
        color: var(--text-normal);
        font-weight: bold;
        margin-bottom: 15px;
    }
    .quran-bullet-chart {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .quran-bullet-value {
        display: flex;
        justify-content: space-between;
        color: var(--text-muted);
        font-size: 0.9em;
    }
    .quran-bullet-bar-container {
        position: relative;
        height: 30px;
        background: #17202A;
        border-radius: 4px;
        overflow: hidden;
    }
    .quran-bullet-bar {
        height: 100%;
        background: steelblue;
        width: ${(total / target) * 100}%;
        transition: width 0.3s;
    }
    .quran-bullet-marker {
        position: absolute;
        top: 0;
        left: ${(1 / target) * 100}%;
        width: 2px;
        height: 100%;
        background: white;
    }
    .quran-bullet-stats {
        display: flex;
        justify-content: space-between;
        margin-top: 10px;
        color: var(--text-normal);
    }
    .quran-bullet-stat {
        text-align: center;
    }
    .quran-bullet-stat-value {
        font-weight: bold;
        color: steelblue;
        font-size: 1.2em;
    }
    .quran-bullet-stat-label {
        font-size: 0.8em;
        color: var(--text-muted);
    }
</style>
`;

let bulletDiv = container.createDiv({ cls: "quran-bullet-container" });

// العنوان
bulletDiv.createDiv({ 
    cls: "quran-bullet-title",
    text: "عدد الصفحات التي قرأتها من القرآن هذا الشهر"
});

let chart = bulletDiv.createDiv({ cls: "quran-bullet-chart" });

// القيمة الحالية والهدف
let valueDiv = chart.createDiv({ cls: "quran-bullet-value" });
valueDiv.createSpan({ text: `المجموع: ${total} صفحة` });
valueDiv.createSpan({ text: `الهدف: ${target} صفحة` });

// شريط التقدم
let barContainer = chart.createDiv({ cls: "quran-bullet-bar-container" });
barContainer.createDiv({ cls: "quran-bullet-bar" });

if (total < target) {
    barContainer.createDiv({ cls: "quran-bullet-marker" });
}

// إحصائيات إضافية
let stats = bulletDiv.createDiv({ cls: "quran-bullet-stats" });
let remaining = Math.max(0, target - total);
let percentage = ((total / target) * 100).toFixed(1);

stats.createDiv({ cls: "quran-bullet-stat", html: `
    <div class="quran-bullet-stat-value">${remaining}</div>
    <div class="quran-bullet-stat-label">المتبقي</div>
`});

stats.createDiv({ cls: "quran-bullet-stat", html: `
    <div class="quran-bullet-stat-value">${percentage}%</div>
    <div class="quran-bullet-stat-label">الإنجاز</div>
`});
```
# Tracker Islamic
![[Tracker B]]