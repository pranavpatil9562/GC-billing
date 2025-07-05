// app.js
const supabase = window.supabase.createClient(
  'https://xkyxrggavdkwdvntxlnc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhreXhyZ2dhdmRrd2R2bnR4bG5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2OTcxMDEsImV4cCI6MjA2NzI3MzEwMX0.9BvjCk8OH8KzfUWokLEsp8AMZQ4Xm5k7jBBRvs_Sjzw'
);
let recentAddresses = JSON.parse(localStorage.getItem('ganesh_addresses') || '[]');
// let billNo = parseInt(localStorage.getItem('ganesh_bill_no') || '1');
let currentUser = null;
let printerDevice = null;
let printerCharacteristic = null;
let groupName = localStorage.getItem('ganesh_group') || 'GANESH GROUP';
window.onload = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('app-section').style.display = 'block';
    document.getElementById('user-email').innerText = `Welcome, ${currentUser.email}`;
    document.getElementById('group-heading').innerText = localStorage.getItem('ganesh_group') || '';
    await tryReconnectPrinter();
  }
  updateAddressSuggestions();

};


async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const group = document.getElementById('group-name').value || 'GANESH GROUP';
  localStorage.setItem('ganesh_group', group); // Save to localStorage
  groupName = group;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return alert('Login failed: ' + error.message);
  currentUser = data.user;
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('app-section').style.display = 'block';
  document.getElementById('user-email').innerText = `Welcome, ${currentUser.email}`;
  await tryReconnectPrinter();
}

async function register() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const group = document.getElementById('group-name').value || 'GANESH GROUP';
  localStorage.setItem('ganesh_group', group); // Save to localStorage
  groupName = group;

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return alert('Registration failed: ' + error.message);
  alert('Registration successful! Check your email.');
}



async function logout() {
  await supabase.auth.signOut();
  localStorage.removeItem('printerId');
  location.reload();
}
async function printBill() {
  const name = document.getElementById('donor-name').value;
  const address = document.getElementById('donor-address').value;
  const amount = parseFloat(document.getElementById('amount').value);
  if (!name || !address || !amount) return alert('Fill in all fields');

  const billNo = await getNextBillNo();
  const date = new Date();
  const groupName = localStorage.getItem('ganesh_group') || 'GANESH GROUP';

  const bill = {
    user_id: currentUser.id,
    name,
    address,
    amount,
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString(),
    bill_no: billNo,
    group_name: groupName
  };

  const { error } = await supabase.from('collection_bills').insert([bill]);
  if (error) return alert('Error saving to database: ' + error.message);

//   localStorage.setItem('ganesh_bill_no', ++billNo);

  // Save recent addresses
  let recentAddresses = JSON.parse(localStorage.getItem('ganesh_addresses') || '[]');
  if (!recentAddresses.includes(address)) {
    recentAddresses.unshift(address);
    if (recentAddresses.length > 10) recentAddresses.pop();
    localStorage.setItem('ganesh_addresses', JSON.stringify(recentAddresses));
  }
  updateAddressSuggestions();

  const confirmation = `
---------------------------
${groupName}
---------------------------
Name: ${name}
Address: ${address}
Amount: ${amount}
Bill No: GC-${bill.bill_no}
Date: ${bill.date} ${bill.time}
---------------------------
Thank you for your support!
---------------------------`;

  printRaw(confirmation);
  document.getElementById('confirmation').innerText = `✅ Bill Saved & Sent to Printer: GC-${bill.bill_no}`;
  document.getElementById('donor-name').value = '';
  document.getElementById('donor-address').value = '';
  document.getElementById('amount').value = '';
}



async function tryReconnectPrinter() {
  const rememberedDeviceId = localStorage.getItem('printerId');
  if (!rememberedDeviceId || !navigator.bluetooth) return;

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
    });
    if (device.id !== rememberedDeviceId) return;
    printerDevice = device;
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    printerCharacteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
  } catch (err) {
    console.warn('Auto reconnect printer failed:', err);
  }
}

function printRaw(text) {
  if (!navigator.bluetooth) {
    alert('Bluetooth not supported.');
    return;
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(text + '\n\n\n');

  if (printerDevice && printerCharacteristic) {
    printerCharacteristic.writeValue(data);
  } else {
    navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
    }).then(device => {
      printerDevice = device;
      localStorage.setItem('printerId', device.id);
      return device.gatt.connect();
    }).then(server => server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb'))
      .then(service => service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb'))
      .then(characteristic => {
        printerCharacteristic = characteristic;
        return characteristic.writeValue(data);
      })
      .catch(console.error);
  }
}
function addReportControls() {
  const container = document.createElement('div');
  container.innerHTML = `
    <h3>📄 Download Collection Report</h3>
    <select id="report-range">
      <option value="today">Today</option>
      <option value="last2">Last 2 Days</option>
      <option value="custom">Custom Range</option>
    </select>
    <div id="custom-range" style="display:none">
      <input type="date" id="start-date" />
      <input type="date" id="end-date" />
    </div>
    <button onclick="downloadReport()">⬇️ Download PDF</button>
  `;
  document.getElementById('app-section').appendChild(container);

  document.getElementById('report-range').addEventListener('change', e => {
    document.getElementById('custom-range').style.display = e.target.value === 'custom' ? 'block' : 'none';
  });
}

async function downloadReport() {
  const range = document.getElementById('report-range').value;
  let startDate = new Date();
  let endDate = new Date();

  if (range === 'today') {
    startDate.setHours(0, 0, 0, 0);
  } else if (range === 'last2') {
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    const s = document.getElementById('start-date').value;
    const e = document.getElementById('end-date').value;
    if (!s || !e) return alert('Select both dates');
    startDate = new Date(s);
    endDate = new Date(e);
    endDate.setHours(23, 59, 59, 999);
  }

  const { data, error } = await supabase
    .from('collection_bills')
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  if (error) return alert('Fetch error: ' + error.message);
  if (!data.length) return alert('No records in this range.');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Ganesh Chaturthi Collection Report', 14, 20);

  const rows = data.map(bill => [
    `GC-${bill.bill_no}`, bill.name, bill.address, `₹${bill.amount}`, bill.date, bill.time
  ]);

  doc.autoTable({
    startY: 30,
    head: [['Bill No', 'Name', 'Address', 'Amount', 'Date', 'Time']],
    body: rows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [255, 112, 67] }
  });

  const startLabel = startDate.toISOString().split('T')[0];
  const endLabel = endDate.toISOString().split('T')[0];
  doc.save(`ganesh_report_${startLabel}_to_${endLabel}.pdf`);
}

if (!recentAddresses.includes(address)) {
  recentAddresses.unshift(address); // Add to top
  if (recentAddresses.length > 10) recentAddresses.pop(); // Limit to 10
  localStorage.setItem('ganesh_addresses', JSON.stringify(recentAddresses));
}
updateAddressSuggestions();
function updateAddressSuggestions() {
  const datalist = document.getElementById('address-suggestions');
  datalist.innerHTML = '';
  const addresses = JSON.parse(localStorage.getItem('ganesh_addresses') || '[]');
  addresses.forEach(addr => {
    const option = document.createElement('option');
    option.value = addr;
    datalist.appendChild(option);
  });
}
async function getNextBillNo() {
  const { data, error } = await supabase
    .from('collection_bills')
    .select('bill_no')
    .order('bill_no', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error fetching bill no:', error.message);
    return 1;
  }

  return data.length ? data[0].bill_no + 1 : 1;
}
