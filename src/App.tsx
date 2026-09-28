import React, { useState, useEffect } from 'react';
import './index.css';

// Types
interface User {
  id: number;
  first_name: string;
  last_name: string;
}

interface Timesheet {
  id: number;
  user_id: number;
  clock_in_time: string;
  clock_out_time: string;
  total: number;
  tags?: any[];
  type?: string;
}

interface UserAggregated {
  user: User;
  regular: number;
  overtime: number;
  double: number;
  pto: number;
  defaultRegular: number;
  defaultOvertime: number;
  defaultDouble: number;
  defaultPto: number;
  regularStr: string;
  overtimeStr: string;
  doubleStr: string;
  ptoStr: string;
  daily: Record<string, number>;
}

const API_URL = import.meta.env.DEV ? '/api' : 'https://ywe3crmpll.execute-api.us-east-2.amazonaws.com/stage';
const API_KEY = import.meta.env.VITE_FP_API_KEY;

function formatHours(seconds: number): string {
  if (!seconds) return '0:00';
  const isNegative = seconds < 0;
  const absSeconds = Math.abs(seconds);
  const h = Math.floor(absSeconds / 3600);
  const m = Math.floor((absSeconds % 3600) / 60);
  const sign = isNegative ? '-' : '';
  return `${sign}${h}:${m.toString().padStart(2, '0')}`;
}

function parseHours(timeStr: string): number {
  if (!timeStr) return 0;
  const isNegative = timeStr.startsWith('-');
  const cleanStr = timeStr.replace('-', '').trim();
  const parts = cleanStr.split(':');
  const h = parseInt(parts[0] || '0', 10) || 0;
  const m = parseInt(parts[1] || '0', 10) || 0;
  const total = (h * 3600) + (m * 60);
  return isNegative ? -total : total;
}

function getPayrollStart(date: Date) {
  const ref = new Date(date);
  ref.setDate(ref.getDate() - 1);
  const day = ref.getDay();
  const diff = day >= 3 ? day - 3 : day + 4;
  ref.setDate(ref.getDate() - diff);
  ref.setHours(0, 0, 0, 0);
  return ref;
}

function getPayrollEnd(date: Date) {
  const d = getPayrollStart(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

const formatDateLocal = (d: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function formatDailyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  
  const days = ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayOfMonth = date.getDate();
  
  let suffix = 'th';
  if (dayOfMonth % 10 === 1 && dayOfMonth !== 11) suffix = 'st';
  else if (dayOfMonth % 10 === 2 && dayOfMonth !== 12) suffix = 'nd';
  else if (dayOfMonth % 10 === 3 && dayOfMonth !== 13) suffix = 'rd';
  
  return `${dayName} ${monthName} - ${dayOfMonth}${suffix}`;
}

function getDisplayDays(startDateStr: string, endDateStr: string, daily: Record<string, number>) {
  const displayDays: { dateStr: string; seconds: number; isMissingWeekday: boolean }[] = [];
  
  if (!startDateStr || !endDateStr) return [];

  const [sy, sm, sd] = startDateStr.split('-').map(Number);
  const [ey, em, ed] = endDateStr.split('-').map(Number);
  
  const startD = new Date(sy, sm - 1, sd);
  const endD = new Date(ey, em - 1, ed);
  
  if (startD > endD) return [];

  const existingDates = new Set(Object.keys(daily));

  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    
    const dayOfWeek = d.getDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const seconds = daily[dateStr] || 0;
    
    existingDates.delete(dateStr);

    if (seconds > 0) {
      displayDays.push({ dateStr, seconds, isMissingWeekday: false });
    } else if (isWeekday) {
      displayDays.push({ dateStr, seconds: 0, isMissingWeekday: true });
    }
  }

  existingDates.forEach(dateStr => {
    const seconds = daily[dateStr];
    if (seconds > 0) {
      displayDays.push({ dateStr, seconds, isMissingWeekday: false });
    }
  });

  displayDays.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

  return displayDays;
}

function App() {
  const today = new Date();
  const defaultStart = formatDateLocal(getPayrollStart(today));
  const defaultEnd = formatDateLocal(getPayrollEnd(today));

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [data, setData] = useState<UserAggregated[]>([]);
  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());

  const toggleUser = (userId: number) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  // Fetch users on load
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const usersRes = await fetch(`${API_URL}/users?limit=1000`, {
          headers: { 'x-api-key': API_KEY }
        });
        if (!usersRes.ok) throw new Error('Failed to fetch users');
        const usersData = await usersRes.json();
        const usersList = Array.isArray(usersData) ? usersData : (usersData.users || usersData.data || usersData.response || []);
        setUsers(usersList);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch users');
      } finally {
        setUsersLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const fetchTimesheets = async () => {
    if (!startDate || !endDate) return;
    if (users.length === 0) {
      setError('Users are still loading, please try again in a moment.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const excludedNames = [
        'Mike Gray', 'Lori Miller', 'John Sutton', 'Jessica Benck', 
        'Jay Baker', 'Ian Wulf', 'Chris Caudy', 'Ryan Coleman', 
        'John Kroese', 'Logan Shattuck', 'Ryan Petersen', 'Dallas Parde'
      ];
      const validUsers = users.filter(u => {
        const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim();
        return !excludedNames.includes(fullName);
      });

      const userMap = new Map<number, UserAggregated>();
      validUsers.forEach(u => {
        userMap.set(u.id, {
          user: u,
          regular: 0,
          overtime: 0,
          double: 0,
          pto: 0,
          defaultRegular: 0,
          defaultOvertime: 0,
          defaultDouble: 0,
          defaultPto: 0,
          regularStr: '0:00',
          overtimeStr: '0:00',
          doubleStr: '0:00',
          ptoStr: '0:00',
          daily: {}
        });
      });

      const fetchPromises = validUsers.map(async (u) => {
        const filterStart = `${startDate} 00:00:00`;
        const filterEnd = `${endDate} 23:59:59`;
        
        const fetchByType = async (type: string) => {
          const url = `${API_URL}/timesheets?limit=1000`
            + `&user_id=${u.id}`
            + `&type=${type}`
            + `&filter[0][attribute]=clock_in_time&filter[0][operator]=%3E%3D&filter[0][value]=${encodeURIComponent(filterStart)}`
            + `&filter[1][attribute]=clock_in_time&filter[1][operator]=%3C%3D&filter[1][value]=${encodeURIComponent(filterEnd)}`;
          
          try {
            const res = await fetch(url, { headers: { 'x-api-key': API_KEY } });
            if (!res.ok) return [];
            const tsData = await res.json();
            if (u.first_name?.toLowerCase() === 'michael' && u.last_name?.toLowerCase() === 'bennett') {
              console.log(`API Response for Michael Bennett (${type}):`, tsData);
            }
            
            let timesheets: Timesheet[] = [];
            if (Array.isArray(tsData)) timesheets = tsData;
            else if (tsData?.timesheets) timesheets = tsData.timesheets;
            else if (tsData?.data) timesheets = tsData.data;
            else if (tsData?.response) timesheets = tsData.response;
            
            return timesheets.map(ts => ({ ...ts, type }));
          } catch {
            return [];
          }
        };

        const [generalTs, jobTs] = await Promise.all([
          fetchByType('general'),
          fetchByType('job')
        ]);
        
        return [...generalTs, ...jobTs];
      });

      const results = await Promise.all(fetchPromises);

      // Process timesheets to avoid double reporting
      const userDayIntervals = new Map<number, Map<string, { start: number; end: number }[]>>();

      results.flat().forEach(ts => {
        if (!ts.clock_in_time || !ts.total) return;
        
        const tsDateOnly = ts.clock_in_time.split(' ')[0];
        if (tsDateOnly >= startDate && tsDateOnly <= endDate) {
          const isDoubleTime = ts.tags?.some(t => {
            const tagName = typeof t === 'string' ? t : (t.name || t.title || t.tag || '');
            return tagName.toLowerCase() === 'double time';
          });

          if (isDoubleTime) {
            const u = userMap.get(ts.user_id);
            if (u) {
              u.double += ts.total;
              u.daily[tsDateOnly] = (u.daily[tsDateOnly] || 0) + ts.total;
            }
            return;
          }

          // Only include 'general' type in regular time
          if (ts.type === 'job') return;

          if (!userDayIntervals.has(ts.user_id)) {
            userDayIntervals.set(ts.user_id, new Map());
          }
          const userDays = userDayIntervals.get(ts.user_id)!;
          
          if (!userDays.has(tsDateOnly)) {
            userDays.set(tsDateOnly, []);
          }
          
          const startStr = ts.clock_in_time.replace(' ', 'T');
          const start = new Date(startStr).getTime();
          let end = start + ts.total * 1000;
          
          userDays.get(tsDateOnly)!.push({ start, end });
        }
      });

      // Merge intervals and calculate totals
      userDayIntervals.forEach((daysMap, userId) => {
        const u = userMap.get(userId);
        if (!u) return;

        let totalSecondsForUser = 0;

        daysMap.forEach((intervals, dateStr) => {
          if (intervals.length === 0) return;
          
          intervals.sort((a, b) => a.start - b.start);
          const merged: { start: number; end: number }[] = [intervals[0]];
          
          for (let i = 1; i < intervals.length; i++) {
            const current = intervals[i];
            const last = merged[merged.length - 1];
            
            if (current.start <= last.end) {
              last.end = Math.max(last.end, current.end);
            } else {
              merged.push(current);
            }
          }
          
          const dayTotalMs = merged.reduce((acc, curr) => acc + (curr.end - curr.start), 0);
          const dayTotalSeconds = Math.floor(dayTotalMs / 1000);
          totalSecondsForUser += dayTotalSeconds;
          u.daily[dateStr] = (u.daily[dateStr] || 0) + dayTotalSeconds;
        });

        u.regular += totalSecondsForUser;
      });

      // Compute Overtime based on 40h/week
      const finalData: UserAggregated[] = [];
      userMap.forEach(u => {
        const maxRegularSeconds = 40 * 3600;
        if (u.regular > maxRegularSeconds) {
          u.overtime = u.regular - maxRegularSeconds;
          u.regular = maxRegularSeconds;
        }

        u.defaultRegular = u.regular;
        u.defaultOvertime = u.overtime;
        u.defaultDouble = u.double;
        u.defaultPto = u.pto;

        u.regularStr = formatHours(u.regular);
        u.overtimeStr = formatHours(u.overtime);
        u.doubleStr = formatHours(u.double);
        u.ptoStr = formatHours(u.pto);

        finalData.push(u);
      });

      // Sort by last name
      finalData.sort((a, b) => (a.user.last_name || '').localeCompare(b.user.last_name || ''));
      setData(finalData);

    } catch (err: any) {
      setError(err.message || 'An error occurred fetching timesheets');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (userId: number, field: 'regular' | 'overtime' | 'double' | 'pto', value: string) => {
    setData(prev => prev.map(row => {
      if (row.user.id !== userId) return row;
      const newRow = { ...row, [`${field}Str`]: value };
      newRow[field] = parseHours(value);
      return newRow;
    }));
  };

  const handleInputBlur = (userId: number, field: 'regular' | 'overtime' | 'double' | 'pto') => {
    setData(prev => prev.map(row => {
      if (row.user.id !== userId) return row;
      return { ...row, [`${field}Str`]: formatHours(row[field]) };
    }));
  };

  const handleRestoreDefault = (userId: number) => {
    setData(prev => prev.map(row => {
      if (row.user.id !== userId) return row;
      return {
        ...row,
        regular: row.defaultRegular,
        overtime: row.defaultOvertime,
        double: row.defaultDouble,
        pto: row.defaultPto,
        regularStr: formatHours(row.defaultRegular),
        overtimeStr: formatHours(row.defaultOvertime),
        doubleStr: formatHours(row.defaultDouble),
        ptoStr: formatHours(row.defaultPto),
      };
    }));
  };

  return (
    <div className="container" style={{ maxWidth: '1200px' }}>
      <div className="header">
        <h1>Weekly Timesheet Summary</h1>
        <p>Overview of employee hours for the selected week.</p>
      </div>

      <div className="controls-card">
        <div className="input-group">
          <label htmlFor="start">Start Date</label>
          <input 
            type="date" 
            id="start" 
            value={startDate} 
            onChange={e => setStartDate(e.target.value)} 
          />
        </div>
        <div className="input-group">
          <label htmlFor="end">End Date</label>
          <input 
            type="date" 
            id="end" 
            value={endDate} 
            onChange={e => setEndDate(e.target.value)} 
          />
        </div>
        <button 
          className="btn-primary" 
          onClick={fetchTimesheets}
          disabled={loading || usersLoading || !startDate || !endDate}
        >
          {loading ? 'Fetching...' : usersLoading ? 'Loading Users...' : 'Fetch Timesheets'}
        </button>
        <button 
          className="btn-secondary"
          style={{ marginLeft: '10px' }}
          onClick={() => window.print()}
          disabled={data.length === 0}
        >
          Print Timesheets
        </button>
      </div>

      {error && (
        <div className="error">
          <p>⚠️ {error}</p>
        </div>
      )}

      {loading && (
        <div className="loading">
          <p>Loading timesheet data...</p>
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="table-container">
          <table className="timesheet-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Regular</th>
                <th>Overtime</th>
                <th>Double</th>
                <th>PTO</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => {
                const total = row.regular + row.overtime + row.pto;
                const isExpanded = expandedUsers.has(row.user.id);
                return (
                  <React.Fragment key={row.user.id}>
                    <tr>
                      <td className="user-name-cell">
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <button 
                            onClick={() => toggleUser(row.user.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: '8px', fontSize: '12px' }}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          {row.user.first_name} {row.user.last_name}
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="timesheet-input"
                          value={row.regularStr}
                          onChange={(e) => handleInputChange(row.user.id, 'regular', e.target.value)}
                          onBlur={() => handleInputBlur(row.user.id, 'regular')}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="timesheet-input"
                          value={row.overtimeStr}
                          onChange={(e) => handleInputChange(row.user.id, 'overtime', e.target.value)}
                          onBlur={() => handleInputBlur(row.user.id, 'overtime')}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="timesheet-input"
                          value={row.doubleStr}
                          onChange={(e) => handleInputChange(row.user.id, 'double', e.target.value)}
                          onBlur={() => handleInputBlur(row.user.id, 'double')}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="timesheet-input"
                          value={row.ptoStr}
                          onChange={(e) => handleInputChange(row.user.id, 'pto', e.target.value)}
                          onBlur={() => handleInputBlur(row.user.id, 'pto')}
                        />
                      </td>
                      <td className="total-cell">{formatHours(total)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="expanded-row">
                        <td colSpan={6} style={{ padding: '10px 20px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                            {(() => {
                              const displayDays = getDisplayDays(startDate, endDate, row.daily);
                              if (displayDays.length === 0) return <span style={{ fontSize: '13px', color: '#6b7280' }}>No daily records.</span>;
                              return displayDays.map(({ dateStr, seconds, isMissingWeekday }) => (
                                <div key={dateStr} style={{ 
                                  border: `1px solid ${isMissingWeekday ? '#f87171' : '#d1d5db'}`, 
                                  padding: '5px 10px', 
                                  borderRadius: '4px', 
                                  backgroundColor: isMissingWeekday ? '#fee2e2' : '#fff', 
                                  color: isMissingWeekday ? '#991b1b' : 'inherit',
                                  fontSize: '13px' 
                                }}>
                                  <strong>{formatDailyDate(dateStr)}:</strong> {isMissingWeekday ? 'Missing' : formatHours(seconds)}
                                </div>
                              ));
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;

