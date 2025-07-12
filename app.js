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
  const savedLogo = localStorage.getItem('user_logo_base64');
  if (savedLogo) {
    document.getElementById('logo-img').src = savedLogo;
  }
};


async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const group = document.getElementById('group-name').value || 'GANESH GROUP';
  const logoFile = document.getElementById('logo-file').files[0];
  const upiId = document.getElementById('upi-id').value;

  if (!logoFile || logoFile.size > 500 * 1024) {
    return alert("Please upload a logo under 500KB.");
  }

  const reader = new FileReader();
  reader.onload = async () => {
    const img = new Image();
    img.src = reader.result;
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const maxWidth = 384;
      const scale = maxWidth / img.width;
      canvas.width = maxWidth;
      canvas.height = img.height * scale;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const resizedBase64 = canvas.toDataURL("image/png");

      localStorage.setItem('user_logo_base64', resizedBase64);
      localStorage.setItem('ganesh_group', group);
      localStorage.setItem('user_upi_id', upiId);

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return alert("Login failed: " + error.message);

      currentUser = data.user;

      document.getElementById('logo-img').src = resizedBase64;
      document.getElementById('group-heading').innerText = group;
      document.getElementById('login-section').style.display = 'none';
      document.getElementById('app-section').style.display = 'block';
      document.getElementById('user-email').innerText = `Welcome, ${currentUser.email}`;
      await tryReconnectPrinter();
    };
  };
  reader.readAsDataURL(logoFile);
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

  const shouldPrintQr = document.getElementById('print-qr-checkbox').checked;
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

  // Save recent addresses
  let recentAddresses = JSON.parse(localStorage.getItem('ganesh_addresses') || '[]');
  if (!recentAddresses.includes(address)) {
    recentAddresses.unshift(address);
    if (recentAddresses.length > 10) recentAddresses.pop();
    localStorage.setItem('ganesh_addresses', JSON.stringify(recentAddresses));
  }
  updateAddressSuggestions();

  // Prepare bill text
  const confirmation =
    `\n ${groupName} \n` +
    `-------------------------------\n` +
    `Donor Name: ${name}\n` +
    `Address: ${address}\n` +
    `Amount in Rupees: ${amount}\n` +
    `Bill No: GC-${bill.bill_no}\n` +
    `Date: ${bill.date}\n` +
    `Time: ${bill.time}\n` +
    `-------------------------------\n` +
    `May lord Ganesha Bless you` +
    `\n${groupName} \n` +
    `Thank you for your support!\n`+
    `Software by 8088047557 \n\n\n`;

  const encoder = new TextEncoder();
  const data = encoder.encode(confirmation);

  // Helper to send chunks
  async function sendInChunks(characteristic, buffer) {
    const chunkSize = 200;
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, i + chunkSize);
      await characteristic.writeValue(chunk);
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }

  // Print logic
  if (!printerDevice || !printerCharacteristic) {
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
    });
    printerDevice = device;
    localStorage.setItem('printerId', device.id);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
    printerCharacteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
  } catch (err) {
    console.error('Printing failed:', err);
    alert('Failed to connect to printer.');
    return;
  }
}

// ✅ Always print logo, text, and QR regardless of connection state
await printLogoToPrinter();
await sendInChunks(printerCharacteristic, data);
if (shouldPrintQr) {
  await printQrCodeToPrinter(name, amount);
}



  // Reset UI
  document.getElementById('confirmation').innerText = `✅ Bill Saved & Sent to Printer: GC-${bill.bill_no}`;
  document.getElementById('donor-name').value = '';
  document.getElementById('donor-address').value = '';
  document.getElementById('amount').value = '';
}

async function printLogoToPrinter() {
  const img = document.getElementById('logo-img');

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  canvas.width = 384;
  canvas.height = img.height * (384 / img.width); // maintain aspect ratio

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const width = canvas.width;
  const height = canvas.height;
  const bytesPerRow = Math.ceil(width / 8);
  const raster = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const brightness = (r + g + b) / 3;
      if (brightness < 128) {
        raster[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  const header = new Uint8Array([
    0x1D, 0x76, 0x30, 0x00,
    bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF
  ]);

  const full = new Uint8Array(header.length + raster.length);
  full.set(header);
  full.set(raster, header.length);

  // Chunked write
  const chunkSize = 512;
  for (let i = 0; i < full.length; i += chunkSize) {
    const chunk = full.slice(i, i + chunkSize);
    await printerCharacteristic.writeValue(chunk);
  }
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
  const groupName = localStorage.getItem('ganesh_group') || 'Ganesh Mandal';
  doc.setFontSize(16);
  doc.text(`${groupName} Collection Report`, 14, 20);

  // 🧮 Calculate totals
const totalReceipts = data.length;
const totalAmount = data.reduce((sum, bill) => sum + parseFloat(bill.amount), 0);

doc.setFontSize(12);
doc.setDrawColor(255); // no border

// Box 1: Total Receipts
doc.setFillColor(255, 224, 178); // light orange (#FFE0B2)
doc.setTextColor(78, 52, 46);    // dark brown (#4E342E)
doc.rect(14, 25, 80, 15, 'F');
doc.text(`Total Receipts: ${totalReceipts}`, 18, 35);

// Box 2: Total Amount
doc.setFillColor(200, 230, 201); // light green (#C8E6C9)
doc.setTextColor(27, 94, 32);    // dark green (#1B5E20)
doc.rect(110, 25, 85, 15, 'F');
doc.text(`Total Amount: ${totalAmount.toFixed(2)}`, 114, 35);

// Reset text color to black for the table
doc.setTextColor(0);

  const rows = data.map(bill => [
    `GC-${bill.bill_no}`, bill.name, bill.address, `${bill.amount}`, bill.date, bill.time
  ]);

  doc.autoTable({
    startY: 45,
    head: [['Bill No', 'Name', 'Address', 'Amount', 'Date', 'Time']],
    body: rows,
    styles: { fontSize: 11 },
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
async function printQrCodeToPrinter(name, amount) {
  const upi = localStorage.getItem('user_upi_id');
  if (!upi || !printerCharacteristic) return;

  const upiUrl = `upi://pay?pa=${upi}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR`;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, upiUrl, { width: 200 });

  const ctx = qrCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
  const width = qrCanvas.width;
  const height = qrCanvas.height;
  const bytesPerRow = Math.ceil(width / 8);
  const raster = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const brightness = (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
      if (brightness < 128) {
        raster[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  const header = new Uint8Array([
    0x1D, 0x76, 0x30, 0x00,
    bytesPerRow & 0xFF, (bytesPerRow >> 8) & 0xFF,
    height & 0xFF, (height >> 8) & 0xFF
  ]);

  const full = new Uint8Array(header.length + raster.length);
  full.set(header);
  full.set(raster, header.length);

  for (let i = 0; i < full.length; i += 512) {
    const chunk = full.slice(i, i + 512);
    await printerCharacteristic.writeValue(chunk);
  }
  const encoder = new TextEncoder();
  const trailingSpace = encoder.encode('\n\n\n');
  await printerCharacteristic.writeValue(trailingSpace);
}
