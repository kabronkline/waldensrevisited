/**
 * Walden's Revisited - Birthday Picker Component
 * A large, accessible three-dropdown date picker for birthdays.
 * Returns YYYY-MM-DD format.
 */

(function() {
  const styleId = 'birthday-picker-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .birthday-picker {
        display: flex;
        gap: 12px;
        align-items: center;
        width: 100%;
        max-width: 500px;
        margin: 10px 0;
      }
      .birthday-picker select {
        flex: 1;
        padding: 14px 12px;
        font-size: 1.1rem;
        font-family: inherit;
        color: var(--forest-deep, #2d4a3e);
        background-color: var(--parchment, #faf8f4);
        border: 2px solid var(--mist, #f4f7f2);
        border-radius: 8px;
        cursor: pointer;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%232d4a3e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 10px center;
        background-size: 18px;
        padding-right: 35px;
      }
      .birthday-picker select:focus {
        border-color: var(--forest-deep, #2d4a3e);
        box-shadow: 0 0 0 3px rgba(45, 74, 62, 0.1);
      }
      .birthday-picker select:hover {
        border-color: var(--stone, #5a6b60);
      }
      .birthday-picker label {
        display: block;
        font-size: 0.85rem;
        color: var(--stone, #5a6b60);
        margin-bottom: 4px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .birthday-picker-group {
        flex: 1;
        display: flex;
        flex-direction: column;
      }
      @media (max-width: 480px) {
        .birthday-picker {
          gap: 8px;
        }
        .birthday-picker select {
          padding: 12px 8px;
          font-size: 1rem;
          padding-right: 28px;
          background-size: 14px;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();

window.createBirthdayPicker = function(containerId, initialValue, onChangeCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  let currentYear = new Date().getFullYear();
  let selYear = '', selMonth = '', selDay = '';

  if (initialValue && /^\d{4}-\d{2}-\d{2}$/.test(initialValue)) {
    const parts = initialValue.split('-');
    selYear = parseInt(parts[0]);
    selMonth = parseInt(parts[1]);
    selDay = parseInt(parts[2]);
  }

  container.innerHTML = `
    <div class="birthday-picker">
      <div class="birthday-picker-group">
        <label>Month</label>
        <select class="bp-month">
          <option value="" disabled ${!selMonth ? 'selected' : ''}>Month</option>
          ${months.map((m, i) => `<option value="${i + 1}" ${selMonth === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="birthday-picker-group">
        <label>Day</label>
        <select class="bp-day">
          <option value="" disabled ${!selDay ? 'selected' : ''}>Day</option>
        </select>
      </div>
      <div class="birthday-picker-group">
        <label>Year</label>
        <select class="bp-year">
          <option value="" disabled ${!selYear ? 'selected' : ''}>Year</option>
          ${Array.from({length: 121}, (_, i) => currentYear - i).map(y => `<option value="${y}" ${selYear === y ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  const monthEl = container.querySelector('.bp-month');
  const dayEl = container.querySelector('.bp-day');
  const yearEl = container.querySelector('.bp-year');

  function updateDays() {
    const month = parseInt(monthEl.value);
    const year = parseInt(yearEl.value) || 2000; // Default to leap year for Feb if no year
    const daysInMonth = new Date(year, month, 0).getDate();
    
    const currentDay = parseInt(dayEl.value);
    dayEl.innerHTML = `<option value="" disabled ${!currentDay ? 'selected' : ''}>Day</option>`;
    
    for (let i = 1; i <= daysInMonth; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = i;
      if (i === currentDay) opt.selected = true;
      dayEl.appendChild(opt);
    }
    
    // If previous selected day is now invalid (e.g. Feb 30), reset it
    if (currentDay > daysInMonth) {
      dayEl.value = "";
    }
  }

  function handleChange() {
    updateDays();
    const y = yearEl.value;
    const m = monthEl.value.padStart(2, '0');
    const d = dayEl.value.padStart(2, '0');
    
    if (y && m !== '00' && d !== '00') {
      const formatted = `${y}-${m}-${d}`;
      if (onChangeCallback) onChangeCallback(formatted);
    }
  }

  monthEl.addEventListener('change', handleChange);
  yearEl.addEventListener('change', handleChange);
  dayEl.addEventListener('change', handleChange);

  // Initial population of days
  updateDays();
  if (selDay) dayEl.value = selDay;
};
