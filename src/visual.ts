/* eslint-disable */
import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import FilterAction = powerbi.FilterAction;

// Import filter types from powerbi-models package
import * as models from "powerbi-models";

interface Range {
    start: Date | null;
    end: Date | null;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private root: HTMLElement;

    // selected period
    private current: Range;

    // drawer open/closed
    private isExpanded: boolean = false;

    // info about the bound Date field so we can filter
    private tableName: string | null = null;
    private columnName: string | null = null;

    // viewport dimensions
    private viewportWidth: number = 0;
    private viewportHeight: number = 0;

    private static styleInjected = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.root = options.element;
        this.root.innerHTML = "";

        // default = last 7 days inclusive
        const today = this.stripTime(new Date());
        const start7 = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() - 6
        );
        this.current = { start: start7, end: today };

        this.injectStyles();
        this.render();
    }

    public update(options: VisualUpdateOptions): void {
        this.viewportWidth = options.viewport.width;
        this.viewportHeight = options.viewport.height;

        const el = this.root as HTMLElement;
        el.style.width = this.viewportWidth + "px";
        el.style.height = this.viewportHeight + "px";

        // try to read table/column for the "Date" role
        if (
            options.dataViews &&
            options.dataViews[0] &&
            options.dataViews[0].categorical
        ) {
            const cat = options.dataViews[0].categorical.categories;
            if (
                cat &&
                cat[0] &&
                cat[0].source &&
                cat[0].source.queryName
            ) {
                const q = cat[0].source.queryName;
                const m = q.match(/^(.+)\.(.+)$/);
                if (m) {
                    this.tableName = m[1];
                    this.columnName = m[2];
                } else {
                    // Try alternative format with brackets
                    const m2 = q.match(/^(.+)\[(.+)\]$/);
                    if (m2) {
                        this.tableName = m2[1];
                        this.columnName = m2[2];
                    } else {
                        this.tableName = q;
                        this.columnName = q;
                    }
                }
            }
        }

        this.render();
    }

    // ---------------- RENDER MAIN WRAPPER ----------------
    private render(): void {
        // clear DOM
        while (this.root.firstChild) {
            this.root.removeChild(this.root.firstChild);
        }

        this.root.className = "sdr-wrapper";

        if (!this.isExpanded) {
            // Collapsed state: show date range pill
            const collapsedBar = document.createElement("div");
            collapsedBar.className = "sdr-collapsed-bar";
            
            const dateRangePill = document.createElement("div");
            dateRangePill.className = "sdr-date-pill";
            
            const calendarIcon = document.createElement("span");
            calendarIcon.className = "sdr-icon";
            calendarIcon.textContent = "📅";
            
            const dateText = document.createElement("span");
            dateText.className = "sdr-date-text";
            dateText.textContent = this.formatRange(this.current);
            
            const daysBadge = document.createElement("span");
            daysBadge.className = "sdr-badge";
            daysBadge.textContent = this.dayCount(this.current) + "d";
            
            const expandIcon = document.createElement("span");
            expandIcon.className = "sdr-expand-icon";
            expandIcon.textContent = "▲";
            
            dateRangePill.appendChild(calendarIcon);
            dateRangePill.appendChild(dateText);
            dateRangePill.appendChild(daysBadge);
            dateRangePill.appendChild(expandIcon);
            
            dateRangePill.addEventListener("click", () => {
                this.isExpanded = true;
                this.render();
            });
            
            collapsedBar.appendChild(dateRangePill);
            this.root.appendChild(collapsedBar);
        } else {
            // Expanded panel - fills entire container
            const panel = document.createElement("div");
            panel.className = "sdr-panel sdr-panel-fullscreen";
            
            // Close button
            const closeBtn = document.createElement("div");
            closeBtn.className = "sdr-close-btn";
            closeBtn.textContent = "✕";
            closeBtn.addEventListener("click", () => {
                this.isExpanded = false;
                this.render();
            });
            panel.appendChild(closeBtn);
            
            // Panel content
            const panelContent = document.createElement("div");
            panelContent.className = "sdr-panel-content";
            
            const useCompactLayout = this.viewportWidth < 650;
            
            if (useCompactLayout) {
                this.buildCompactLayout(panelContent);
            } else {
                this.buildFullLayout(panelContent);
            }
            
            panel.appendChild(panelContent);
            this.root.appendChild(panel);
        }
    }

    // ---------------- FULL LAYOUT ----------------
    private buildFullLayout(container: HTMLElement): void {
        const leftCol = document.createElement("div");
        leftCol.className = "sdr-presets-panel";
        this.buildPresets(leftCol);
        container.appendChild(leftCol);

        const rightCol = document.createElement("div");
        rightCol.className = "sdr-calendar-panel";
        this.buildCalendarCard(rightCol);
        container.appendChild(rightCol);
    }

    // ---------------- COMPACT LAYOUT ----------------
    private buildCompactLayout(container: HTMLElement): void {
        const presetsRow = document.createElement("div");
        presetsRow.className = "sdr-compact-presets";
        this.buildCompactPresets(presetsRow);
        container.appendChild(presetsRow);

        const calendarArea = document.createElement("div");
        calendarArea.className = "sdr-calendar-panel";
        this.buildCalendarCard(calendarArea);
        container.appendChild(calendarArea);
    }

    // ---------------- COMPACT PRESETS ----------------
    private buildCompactPresets(container: HTMLElement): void {
        const presets: Array<{ label: string; key: string }> = [
            { label: "Today", key: "today" },
            { label: "Yesterday", key: "yesterday" },
            { label: "7d", key: "last7" },
            { label: "14d", key: "last14" },
            { label: "30d", key: "last30" },
            { label: "60d", key: "last60" }
        ];

        presets.forEach(p => {
            const btn = document.createElement("button");
            btn.className = "sdr-compact-btn";
            btn.textContent = p.label;
            btn.addEventListener("click", () => {
                this.applyPreset(p.key);
            });
            container.appendChild(btn);
        });
    }

    // ---------------- PRESET PANEL ----------------
    private buildPresets(container: HTMLElement): void {
        const title = document.createElement("div");
        title.className = "sdr-presets-title";
        title.textContent = "Quick ranges";
        container.appendChild(title);

        const presets: Array<{ label: string; key: string }> = [
            { label: "Today",        key: "today" },
            { label: "Yesterday",    key: "yesterday" },
            { label: "Last 7 days",  key: "last7" },
            { label: "Last 14 days", key: "last14" },
            { label: "Last 30 days", key: "last30" },
            { label: "Last 60 days", key: "last60" }
        ];

        presets.forEach(p => {
            const btn = document.createElement("div");
            btn.className = "sdr-preset-item";
            btn.textContent = p.label;
            btn.addEventListener("click", () => {
                this.applyPreset(p.key);
            });
            container.appendChild(btn);
        });
    }

    private applyPreset(which: string): void {
        const today = this.stripTime(new Date());
        const mkDate = (daysAgo: number) =>
            this.stripTime(new Date(
                today.getFullYear(),
                today.getMonth(),
                today.getDate() - daysAgo
            ));

        let start = today;
        let end = today;

        switch (which) {
            case "today":
                start = today;
                end = today;
                break;
            case "yesterday":
                start = mkDate(1);
                end = mkDate(1);
                break;
            case "last7":
                start = mkDate(6);
                end = today;
                break;
            case "last14":
                start = mkDate(13);
                end = today;
                break;
            case "last30":
                start = mkDate(29);
                end = today;
                break;
            case "last60":
                start = mkDate(59);
                end = today;
                break;
        }

        this.current = { start, end };
        this.persistSelection();
        this.applyFilterToReport();
        this.render();
    }

    // ---------------- CALENDAR CARD ----------------
    private buildCalendarCard(container: HTMLElement): void {
        // Header
        const header = document.createElement("div");
        header.className = "sdr-card-header";
        header.textContent = "Select Date Range";
        container.appendChild(header);

        // Range line
        const rangeLine = document.createElement("div");
        rangeLine.className = "sdr-range-line";
        rangeLine.textContent = this.formatRange(this.current);
        container.appendChild(rangeLine);

        // Calendar block
        const calBlock = document.createElement("div");
        calBlock.className = "sdr-cal-block";

        const monthLabel = document.createElement("div");
        monthLabel.className = "sdr-month-label";
        monthLabel.textContent = this.getMonthLabel(this.current);
        calBlock.appendChild(monthLabel);

        const calTable = document.createElement("div");
        calTable.className = "sdr-cal-table";
        this.buildCalendarTable(calTable, this.current, (r: Range) => {
            this.current = r;
            this.render();
        });
        calBlock.appendChild(calTable);

        container.appendChild(calBlock);

        // Current Period Days row
        const daysWrap = document.createElement("div");
        daysWrap.className = "sdr-days-wrap";

        const daysLabel = document.createElement("div");
        daysLabel.className = "sdr-days-label";
        daysLabel.textContent = "Selected Period";

        const daysValue = document.createElement("div");
        daysValue.className = "sdr-days-value";
        daysValue.textContent = this.dayCount(this.current) + " Days";

        daysWrap.appendChild(daysLabel);
        daysWrap.appendChild(daysValue);
        container.appendChild(daysWrap);

        // From / To manual inputs
        const inputsRow = document.createElement("div");
        inputsRow.className = "sdr-input-row";

        // From
        const fromCol = document.createElement("div");
        fromCol.className = "sdr-input-col";

        const fromLabel = document.createElement("div");
        fromLabel.className = "sdr-input-label";
        fromLabel.textContent = "From";

        const fromInput = document.createElement("input");
        fromInput.className = "sdr-date-input";
        fromInput.type = "date";
        fromInput.value = this.current.start ? this.toInputDate(this.current.start) : "";
        fromInput.addEventListener("change", () => {
            const d = fromInput.value
                ? new Date(fromInput.value + "T00:00:00")
                : null;
            this.current = { start: d, end: this.current.end };
            this.render();
        });

        fromCol.appendChild(fromLabel);
        fromCol.appendChild(fromInput);

        // To
        const toCol = document.createElement("div");
        toCol.className = "sdr-input-col";

        const toLabel = document.createElement("div");
        toLabel.className = "sdr-input-label";
        toLabel.textContent = "To";

        const toInput = document.createElement("input");
        toInput.className = "sdr-date-input";
        toInput.type = "date";
        toInput.value = this.current.end ? this.toInputDate(this.current.end) : "";
        toInput.addEventListener("change", () => {
            const d = toInput.value
                ? new Date(toInput.value + "T00:00:00")
                : null;
            this.current = { start: this.current.start, end: d };
            this.render();
        });

        toCol.appendChild(toLabel);
        toCol.appendChild(toInput);

        inputsRow.appendChild(fromCol);
        inputsRow.appendChild(toCol);
        container.appendChild(inputsRow);

        // Action buttons
        const actions = document.createElement("div");
        actions.className = "sdr-actions";

        // Clear Filter button
        const btnClear = document.createElement("button");
        btnClear.className = "sdr-btn sdr-btn-secondary";
        btnClear.textContent = "Clear Filter";
        btnClear.addEventListener("click", () => {
            this.clearFilter();
        });

        // Apply Filter button
        const btnApply = document.createElement("button");
        btnApply.className = "sdr-btn sdr-btn-primary";
        btnApply.textContent = "Apply Filter";
        btnApply.addEventListener("click", () => {
            this.persistSelection();
            this.applyFilterToReport();
            this.isExpanded = false;
            this.render();
        });

        actions.appendChild(btnClear);
        actions.appendChild(btnApply);
        container.appendChild(actions);
    }

    // ---------------- CALENDAR TABLE WITH CLICKABLE WEEKS ----------------
    private buildCalendarTable(
        container: HTMLElement,
        range: Range,
        onChange: (r: Range) => void
    ): void {
        const base = range.start ? new Date(range.start) : new Date();
        const year = base.getFullYear();
        const month = base.getMonth();

        const first = new Date(year, month, 1);
        const last = new Date(year, month + 1, 0);
        const firstDow = first.getDay();

        const weeks: Array<(number | null)[]> = [];
        let currentWeek: (number | null)[] = [null, null, null, null, null, null, null];

        for (let i = 0; i < firstDow; i++) {
            currentWeek[i] = null;
        }

        for (let d = 1; d <= last.getDate(); d++) {
            const thisDate = new Date(year, month, d);
            const dow = thisDate.getDay();
            currentWeek[dow] = d;

            if (dow === 6 || d === last.getDate()) {
                weeks.push(currentWeek);
                currentWeek = [null, null, null, null, null, null, null];
            }
        }

        // header row
        const headerRow = document.createElement("div");
        headerRow.className = "sdr-row sdr-row-header";

        const corner = document.createElement("div");
        corner.className = "sdr-weeklabel sdr-weeklabel-header";
        corner.textContent = "";
        headerRow.appendChild(corner);

        const weekdayNames = ["S", "M", "T", "W", "T", "F", "S"];
        weekdayNames.forEach(wd => {
            const cell = document.createElement("div");
            cell.className = "sdr-dayheader";
            cell.textContent = wd;
            headerRow.appendChild(cell);
        });

        container.appendChild(headerRow);

        const selStart = range.start
            ? this.stripTime(range.start).getTime()
            : null;
        const selEnd = range.end
            ? this.stripTime(range.end).getTime()
            : null;

        // build week rows
        for (let w = 0; w < weeks.length; w++) {
            const rowDiv = document.createElement("div");
            rowDiv.className = "sdr-row";

            const weekLabel = document.createElement("div");
            weekLabel.className = "sdr-weeklabel sdr-weeklabel-clickable";
            weekLabel.textContent = "W" + (w + 1);
            weekLabel.title = "Click to select this week";
            
            // Make week label clickable - selects the entire week
            weekLabel.addEventListener("click", () => {
                const rowDays = weeks[w];
                let weekStart: Date | null = null;
                let weekEnd: Date | null = null;
                
                // Find first and last non-null day in this week
                for (let dow = 0; dow < 7; dow++) {
                    const dayNum = rowDays[dow];
                    if (dayNum !== null) {
                        const dt = new Date(year, month, dayNum);
                        if (!weekStart) weekStart = dt;
                        weekEnd = dt;
                    }
                }
                
                if (weekStart && weekEnd) {
                    onChange({ start: weekStart, end: weekEnd });
                }
            });
            
            rowDiv.appendChild(weekLabel);

            const rowDays = weeks[w];
            for (let dow = 0; dow < 7; dow++) {
                const dayNum = rowDays[dow];
                const dayCell = document.createElement("div");

                if (dayNum === null) {
                    dayCell.className = "sdr-daycell sdr-daycell-empty";
                    dayCell.textContent = "";
                    rowDiv.appendChild(dayCell);
                    continue;
                }

                const actualDate = new Date(year, month, dayNum);
                const thisMs = this.stripTime(actualDate).getTime();

                let cls = "sdr-daycell";
                if (selStart !== null && selEnd !== null) {
                    if (thisMs >= selStart && thisMs <= selEnd) {
                        cls += " sdr-daycell-selected";
                    }
                }
                dayCell.className = cls;
                dayCell.textContent = String(dayNum);

                dayCell.addEventListener("click", () => {
                    let newRange: Range;
                    if (!range.start || (range.start && range.end)) {
                        newRange = { start: actualDate, end: null };
                    } else {
                        const startOnly = range.start;
                        const startMs = this.stripTime(startOnly).getTime();
                        if (thisMs < startMs) {
                            newRange = { start: actualDate, end: startOnly };
                        } else {
                            newRange = { start: startOnly, end: actualDate };
                        }
                    }
                    onChange(newRange);
                });

                rowDiv.appendChild(dayCell);
            }

            container.appendChild(rowDiv);
        }
    }

    // ---------------- APPLY / CLEAR FILTER ----------------
    private persistSelection(): void {
        this.host.persistProperties({
            merge: [
                {
                    objectName: "general",
                    properties: {
                        currentStart: this.current.start
                            ? this.current.start.toISOString()
                            : null,
                        currentEnd: this.current.end
                            ? this.current.end.toISOString()
                            : null,
                        dayCountCurrent: this.dayCount(this.current)
                    },
                    selector: null
                }
            ]
        });
    }

    private applyFilterToReport(): void {
        if (!this.current.start || !this.current.end) return;
        if (!this.tableName || !this.columnName) return;

        // Set start of day for start date and end of day for end date
        const startDate = new Date(this.current.start);
        startDate.setHours(0, 0, 0, 0);
        
        const endDate = new Date(this.current.end);
        endDate.setHours(23, 59, 59, 999);

        const target: models.IFilterTarget = {
            table: this.tableName,
            column: this.columnName
        };

        const filter = new models.AdvancedFilter(
            target,
            "And",
            [
                { 
                    operator: "GreaterThanOrEqual", 
                    value: startDate.toISOString()
                },
                { 
                    operator: "LessThanOrEqual", 
                    value: endDate.toISOString()
                }
            ]
        );

        this.host.applyJsonFilter(
            filter,
            "general",
            "filter",
            FilterAction.merge
        );
    }

    private clearFilter(): void {
        if (!this.tableName || !this.columnName) return;

        const target: models.IFilterTarget = {
            table: this.tableName,
            column: this.columnName
        };

        // Remove the filter by applying an empty AdvancedFilter
        this.host.applyJsonFilter(
            null,
            "general",
            "filter",
            FilterAction.remove
        );

        this.isExpanded = false;
        this.render();
    }

    // ---------------- HELPERS ----------------
    private stripTime(d: Date): Date {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    private pad2(n: number): string {
        return n < 10 ? "0" + n : String(n);
    }

    private toInputDate(d: Date): string {
        return (
            d.getFullYear() +
            "-" +
            this.pad2(d.getMonth() + 1) +
            "-" +
            this.pad2(d.getDate())
        );
    }

    private formatRange(r: Range): string {
        const fmt = (dt: Date | null) => {
            if (!dt) return "—";
            const dd = this.pad2(dt.getDate());
            const mm = this.pad2(dt.getMonth() + 1);
            const yyyy = dt.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        };
        return fmt(r.start) + " - " + fmt(r.end);
    }

    private getMonthLabel(r: Range): string {
        const base = r.start ? r.start : new Date();
        const monthName = base.toLocaleString("en-GB", { month: "long" });
        const yr = base.getFullYear();
        return `${monthName}, ${yr}`;
    }

    private dayCount(r: Range): number {
        if (!r.start || !r.end) return 0;
        const a = this.stripTime(r.start).getTime();
        const b = this.stripTime(r.end).getTime();
        return Math.abs(Math.round((b - a) / 86400000)) + 1;
    }

    // ---------------- STYLE INJECTION ----------------
    private injectStyles(): void {
        if (Visual.styleInjected) return;
        Visual.styleInjected = true;

        const css = `
/* Main wrapper */
.sdr-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, sans-serif;
    background-color: transparent;
    overflow: hidden;
}

/* Collapsed bar */
.sdr-collapsed-bar {
    padding: 12px;
    display: flex;
    align-items: center;
}

/* Date range pill */
.sdr-date-pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    background: linear-gradient(135deg, #0078d4 0%, #1085e2 100%);
    color: #ffffff;
    border-radius: 24px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 120, 212, 0.3);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    user-select: none;
}

.sdr-date-pill:hover {
    box-shadow: 0 4px 16px rgba(0, 120, 212, 0.4);
    transform: translateY(-2px);
}

.sdr-icon {
    font-size: 16px;
}

.sdr-date-text {
    font-weight: 600;
    letter-spacing: 0.3px;
}

.sdr-badge {
    background-color: rgba(255, 255, 255, 0.25);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
}

.sdr-expand-icon {
    font-size: 10px;
    opacity: 0.9;
}

/* Expanded panel - FULLSCREEN */
.sdr-panel {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #ffffff;
    z-index: 1000;
    overflow-y: auto;
    animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

/* Close button */
.sdr-close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f5f5f5;
    border-radius: 50%;
    cursor: pointer;
    font-size: 18px;
    color: #666666;
    transition: all 0.2s;
    z-index: 10;
}

.sdr-close-btn:hover {
    background-color: #e0e0e0;
    color: #000000;
    transform: rotate(90deg);
}

/* Panel content - FILLS CONTAINER */
.sdr-panel-content {
    padding: 24px;
    padding-top: 60px;
    height: 100%;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 24px;
    overflow-y: auto;
}

@media (max-width: 650px) {
    .sdr-panel-content {
        grid-template-columns: 1fr;
        gap: 16px;
        padding: 16px;
        padding-top: 60px;
    }
}

/* Compact presets */
.sdr-compact-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-bottom: 16px;
    border-bottom: 1px solid #e0e0e0;
}

.sdr-compact-btn {
    font-size: 12px;
    padding: 8px 16px;
    border: 1px solid #d0d0d0;
    border-radius: 18px;
    background-color: #ffffff;
    color: #1a1a1a;
    cursor: pointer;
    font-family: inherit;
    font-weight: 500;
    transition: all 0.2s;
}

.sdr-compact-btn:hover {
    background-color: #0078d4;
    color: #ffffff;
    border-color: #0078d4;
    transform: scale(1.05);
}

/* Presets panel */
.sdr-presets-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.sdr-presets-title {
    font-weight: 600;
    font-size: 14px;
    color: #1a1a1a;
    margin-bottom: 8px;
}

.sdr-preset-item {
    cursor: pointer;
    padding: 12px 16px;
    font-size: 14px;
    color: #1a1a1a;
    border-radius: 8px;
    transition: all 0.2s;
    background-color: #f8f8f8;
    border: 1px solid transparent;
}

.sdr-preset-item:hover {
    background-color: #e6f3ff;
    border-color: #0078d4;
    color: #0078d4;
    transform: translateX(4px);
}

/* Calendar panel */
.sdr-calendar-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.sdr-card-header {
    font-weight: 600;
    font-size: 20px;
    color: #1a1a1a;
}

.sdr-range-line {
    font-size: 15px;
    color: #0078d4;
    font-weight: 600;
    padding: 10px 16px;
    background-color: #f0f8ff;
    border-radius: 8px;
    display: inline-block;
}

/* Calendar block */
.sdr-cal-block {
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    background-color: #fafafa;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.sdr-month-label {
    font-weight: 600;
    font-size: 16px;
    color: #1a1a1a;
}

.sdr-cal-table {
    display: grid;
    grid-template-columns: 50px repeat(7, 1fr);
    gap: 8px;
}

.sdr-row {
    display: contents;
}

.sdr-dayheader {
    font-weight: 600;
    font-size: 12px;
    text-align: center;
    background-color: #ffffff;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 10px 4px;
    color: #666666;
}

.sdr-weeklabel,
.sdr-weeklabel-header {
    font-size: 11px;
    font-weight: 600;
    color: #999999;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
}

.sdr-weeklabel-clickable {
    cursor: pointer;
    color: #0078d4;
    background-color: #f0f8ff;
    border-radius: 6px;
    transition: all 0.2s;
    border: 1px solid transparent;
}

.sdr-weeklabel-clickable:hover {
    background-color: #0078d4;
    color: #ffffff;
    transform: scale(1.1);
    border-color: #0078d4;
    box-shadow: 0 2px 8px rgba(0, 120, 212, 0.3);
}

.sdr-daycell,
.sdr-daycell-empty {
    text-align: center;
    font-size: 14px;
    padding: 12px 4px;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    background-color: #ffffff;
    color: #1a1a1a;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
}

.sdr-daycell:hover {
    background-color: #f0f8ff;
    border-color: #0078d4;
    transform: scale(1.08);
    box-shadow: 0 2px 8px rgba(0, 120, 212, 0.2);
}

.sdr-daycell-empty {
    background-color: #fafafa;
    color: #cccccc;
    cursor: default;
    border-color: #f0f0f0;
}

.sdr-daycell-empty:hover {
    background-color: #fafafa;
    border-color: #f0f0f0;
    transform: none;
    box-shadow: none;
}

.sdr-daycell-selected {
    background-color: #0078d4;
    border-color: #0078d4;
    color: #ffffff;
    font-weight: 600;
}

.sdr-daycell-selected:hover {
    background-color: #1085e2;
    border-color: #1085e2;
}

/* Days info */
.sdr-days-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background-color: #f0f8ff;
    border-radius: 8px;
}

.sdr-days-label {
    font-size: 14px;
    font-weight: 500;
    color: #666666;
}

.sdr-days-value {
    font-size: 20px;
    font-weight: 700;
    color: #0078d4;
}

/* Date inputs */
.sdr-input-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}

.sdr-input-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.sdr-input-label {
    font-size: 13px;
    font-weight: 600;
    color: #666666;
}

.sdr-date-input {
    font-size: 14px;
    padding: 12px 14px;
    border: 1px solid #d0d0d0;
    border-radius: 8px;
    background-color: #ffffff;
    color: #1a1a1a;
    font-family: inherit;
    transition: all 0.2s;
}

.sdr-date-input:focus {
    outline: none;
    border-color: #0078d4;
    box-shadow: 0 0 0 3px rgba(0, 120, 212, 0.1);
}

/* Actions */
.sdr-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 12px;
}

.sdr-btn {
    font-size: 14px;
    padding: 12px 24px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
    transition: all 0.2s;
}

.sdr-btn-secondary {
    background-color: #f5f5f5;
    color: #666666;
    border: 1px solid #d0d0d0;
}

.sdr-btn-secondary:hover {
    background-color: #e0e0e0;
    color: #000000;
    transform: translateY(-2px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.sdr-btn-primary {
    background: linear-gradient(135deg, #0078d4 0%, #1085e2 100%);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(0, 120, 212, 0.3);
}

.sdr-btn-primary:hover {
    box-shadow: 0 4px 16px rgba(0, 120, 212, 0.4);
    transform: translateY(-2px);
}

/* Responsive */
@media (max-width: 650px) {
    .sdr-cal-table {
        grid-template-columns: 40px repeat(7, 1fr);
        gap: 4px;
    }
    
    .sdr-daycell,
    .sdr-daycell-empty {
        min-height: 36px;
        font-size: 13px;
        padding: 8px 2px;
    }
    
    .sdr-input-row {
        grid-template-columns: 1fr;
    }
    
    .sdr-actions {
        flex-direction: column;
    }
    
    .sdr-btn {
        width: 100%;
    }
}
        `.trim();

        const styleTag = document.createElement("style");
        styleTag.setAttribute("type", "text/css");
        styleTag.textContent = css;
        document.head.appendChild(styleTag);
    }
}