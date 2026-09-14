/** Browser contracts for the actionable review shortcut, compact capture, extraction, manual review, and auth. */
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

test('receipt list filters by an inclusive date range and paginates', async ({ page }, info) => {
  let signedIn = false;
  const receipts = Array.from({ length: 12 }, (_, index) => {
    const day = 12 - index;
    return {
      id: `receipt-${day}`,
      filename: `receipt-${day}.png`,
      mime: 'image/png',
      state: day === 12 ? 'duplicate_candidate' : day % 3 === 0 ? 'needs_review' : 'confirmed',
      fields: {
        merchant: `Merchant ${day}`,
        date: `2026-09-${String(day).padStart(2, '0')}`,
        subtotal: 1000,
        tax: 130,
        tip: null,
        total: 1130,
        currency: 'CAD',
        category: 'Office supplies',
      },
      original: null,
      confidence: {},
      warnings: [],
      error: null,
      version: 1,
      duplicate_of: null,
      confirmed_at: new Date().toISOString(),
      created: new Date().toISOString(),
    };
  });

  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (pathname === '/api/auth/register') { signedIn = true; return send({ ok: true }); }
    if (!signedIn) return send({ error: 'Please sign in.' }, 401);
    if (pathname === '/api/me') return send({ user:{name:'Alex',email:'alex@example.ca'},workspace:{name:'Studio',forwarding:null},quota:{plan:'free',used:12,limit:25,period:'lifetime',canUpload:true},billingAvailable:false,hasCustomer:false,hasSubscription:false,extractionAvailable:false,notifications:[] });
    if (pathname === '/api/receipts') return send(receipts);
    if (pathname === '/api/exports') return send([]);
    return send({ error: `Unexpected request ${route.request().method()} ${pathname}` }, 500);
  });

  await page.goto('/');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Business name').fill('Studio');
  await page.getByLabel('Email address').fill(`${randomUUID()}@example.ca`);
  await page.getByLabel('Password', { exact: true }).fill('a very long password');
  await page.getByRole('button', { name: 'Create your account' }).click();

  await page.getByLabel('Receipts from').fill('2026-09-08');
  await page.getByLabel('Receipts to').fill('2026-09-10');
  await page.getByLabel('Search receipts').fill('Merchant 9');
  const reviewShortcut = page.getByRole('button', { name: 'Review 4 receipts', exact: true });
  await expect(reviewShortcut).toBeVisible();
  await reviewShortcut.click();
  await expect(page.getByLabel('Receipt status')).toHaveText('2 statuses');
  await expect(page.getByLabel('Receipts from')).toHaveValue('');
  await expect(page.getByLabel('Receipts to')).toHaveValue('');
  await expect(page.getByLabel('Search receipts')).toHaveValue('');
  await expect(page.getByText('4 receipts', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 12/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 3/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 11/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByRole('button', { name: /Merchant 12/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 2/ })).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}-receipt-filters.png`, fullPage: true });
  await page.getByRole('button', { name: 'Next receipt page' }).click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 2/ })).toBeVisible();

  await page.getByLabel('Receipts from').fill('2026-09-03');
  await page.getByLabel('Receipts to').fill('2026-09-11');
  await expect(page.getByRole('button', { name: /Merchant 11/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 3/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 12/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Merchant 2/ })).toHaveCount(0);
  await expect(page.getByText('1–9 of 9 receipts')).toBeVisible();

  await page.getByLabel('Receipt status').click();
  await page.getByLabel('Needs review').check();
  await expect(page.getByRole('button', { name: /Merchant 9/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 6/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 3/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Merchant 11/ })).toHaveCount(0);
  await expect(page.getByText('1–3 of 3 receipts')).toBeVisible();
  await expect(page.getByText('3 receipts', { exact: true })).toBeVisible();

  await page.getByLabel('Confirmed').check();
  await expect(page.getByRole('button', { name: /Merchant 11/ })).toBeVisible();
  await expect(page.getByText('9 receipts', { exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Your receipts', exact: true }).click();
  await expect(page.locator('.status-filter details')).not.toHaveAttribute('open', '');

  await page.getByLabel('Search receipts').fill('Merchant 11');
  await expect(page.getByText('1 receipt', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Receipts from')).toHaveValue('2026-09-03');
  await expect(page.getByLabel('Receipts to')).toHaveValue('2026-09-11');
  await expect(page.getByLabel('Search receipts')).toHaveValue('Merchant 11');
  await expect(page.getByLabel('Receipt status')).toHaveText('2 statuses');
  await expect(page.getByText('1 receipt', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByLabel('Receipts from')).toHaveValue('');
  await expect(page.getByLabel('Receipts to')).toHaveValue('');
  await expect(page.getByLabel('Search receipts')).toHaveValue('');
  await expect(page.getByLabel('Receipt status')).toHaveText('Any status');
  await expect(page.getByText('12 receipts', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset filters' })).toHaveCount(0);
});

test('Next receipt UI: direct upload, correction and queued export contracts', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let signedIn = false; let receipt: any = null; let exported = false; let original: Buffer;
  const id = randomUUID(); const exportId = randomUUID();
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const pathname = url.pathname; const method = route.request().method();
    const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (pathname === '/api/auth/register') { signedIn = true; return send({ ok: true }); }
    if (!signedIn) return send({ error: 'Please sign in.' }, 401);
    if (pathname === '/api/me') return send({ user: {name:'Alex Morgan',email:'alex@example.ca'}, workspace:{name:'Northline Studio',forwarding:null}, quota:{plan:'free',used:receipt ? 1 : 0,limit:25,period:'lifetime',canUpload:true}, billingAvailable:false,hasCustomer:false,hasSubscription:false,extractionAvailable:false,notifications:[] });
    if (pathname === '/api/receipts') return send(receipt ? [receipt] : []);
    if (pathname === '/api/uploads') return send({ id, url: `${url.origin}/test-storage/upload` });
    if (pathname === `/api/uploads/${id}/complete`) {
      const duplicate = !!receipt;
      receipt ||= { id,filename:'cafe.png',mime:'image/png',state:'failed',fields:{merchant:'',date:'',subtotal:null,tax:null,tip:null,total:null,currency:'CAD',category:'Uncategorized'}, original:null,confidence:{},warnings:[],error:'Automatic extraction is not configured. Enter the details manually.',version:1,duplicate_of:null,confirmed_at:null,created:new Date().toISOString() };
      return send({ id, duplicate });
    }
    if (pathname === `/api/receipts/${id}/link`) return send({ url:`${url.origin}/test-storage/original` });
    if (pathname === `/api/receipts/${id}` && method === 'PUT') { receipt = {...receipt,fields:route.request().postDataJSON().fields,state:'needs_review',error:null,version:receipt.version+1}; return send(receipt); }
    if (pathname === `/api/receipts/${id}/confirm`) { receipt = {...receipt,state:'confirmed',confirmed_at:new Date().toISOString(),version:receipt.version+1}; return send(receipt); }
    if (pathname === `/api/receipts/${id}`) return send(receipt);
    if (pathname === '/api/exports' && method === 'POST') { exported = true; return send({id:exportId,status:'queued'},202); }
    if (pathname === '/api/exports') return send(exported ? [{id:exportId,format:'zip',status:'complete',error:null}] : []);
    if (pathname === `/api/exports/${exportId}`) return send({id:exportId,status:'complete',url:`${url.origin}/test-storage/export`});
    return send({error:`Unexpected test request ${method} ${pathname}`},500);
  });
  await page.route('**/test-storage/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/upload')) { expect(route.request().method()).toBe('PUT'); original = route.request().postDataBuffer()!; return route.fulfill({status:200,body:'{}'}); }
    if (pathname.endsWith('/original')) return route.fulfill({status:200,contentType:'image/png',body:original});
    return route.fulfill({status:200,contentType:'application/zip',headers:{'Content-Disposition':'attachment; filename="mapletally.zip"'},body:'contract-test-download'});
  });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByLabel('Business name').fill('Northline Studio');
  await page.getByLabel('Email address').fill(`${randomUUID()}@example.ca`);
  await page.getByLabel('Password', { exact: true }).fill('my long test password');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('heading', { name: 'Your receipts', exact: true })).toBeVisible();
  const captureHeight = (await page.locator('.capture-card').boundingBox())!.height;
  expect(captureHeight).toBeLessThan(info.project.name === 'mobile' ? 280 : 220);
  const cameraChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Take a photo', exact: true }).click();
  const cameraChooser = await cameraChooserPromise;
  expect(await cameraChooser.element().getAttribute('capture')).toBe('environment');
  await page.screenshot({ path: `test-results/${info.project.name}-workspace.png`, fullPage: true });
  const bytes = await sharp(Buffer.from('<svg width="420" height="650" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="650" fill="#fffdf8"/><g fill="#333" font-family="sans-serif"><text x="80" y="80" font-size="28">MAPLE CAFE</text><text x="80" y="140" font-size="18">September 12, 2026</text><text x="60" y="250" font-size="20">Subtotal             $10.00</text><text x="60" y="300" font-size="20">HST                     $1.30</text><text x="60" y="350" font-size="20">Tip                       $2.00</text><text x="60" y="430" font-size="24">TOTAL CAD      $13.30</text></g></svg>')).png().toBuffer();
  const addChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add receipt', exact: true }).click();
  const addChooser = await addChooserPromise;
  await addChooser.setFiles({ name: 'cafe.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'Review receipt', exact: true })).toBeVisible();
  if (info.project.name === 'mobile') {
    const detailsBox = await page.locator('.review-fields').boundingBox();
    const originalBox = await page.locator('.original-panel').boundingBox();
    expect(detailsBox!.y).toBeLessThan(originalBox!.y);
  }
  await page.getByRole('button', { name: 'Back to receipts' }).click();
  await expect(page.getByRole('button', { name: /cafe.png/ })).toContainText('failed', { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'No receipts need review', exact: true })).toBeDisabled();
  await expect(page.getByText('1–1 of 1 receipt', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /cafe.png/ }).click();
  await expect(page.getByText('Automatic extraction is not configured.', { exact: false })).toBeVisible();
  await page.getByLabel('Merchant', { exact: true }).fill('Maple Café');
  await page.getByLabel('Receipt date').fill('2026-09-12');
  await page.getByLabel('Subtotal', { exact: true }).fill('10');
  await page.getByLabel('Sales tax', { exact: true }).fill('1.30');
  await page.getByLabel('Tip', { exact: true }).fill('2');
  await page.getByLabel('Total', { exact: true }).fill('13.30');
  await expect(page.getByRole('button', { name: 'Confirm receipt', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm receipt', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
  await expect(page.locator('.page-heading .status')).toHaveText('confirmed');
  await page.screenshot({ path: `test-results/${info.project.name}-review.png`, fullPage: true });
  await page.getByRole('button', { name: 'Back to receipts' }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'same.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('already in your workspace');
  await page.getByRole('button', { name: 'Back to receipts' }).click();
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare ZIP' }).click();
  await expect(page.getByRole('status')).toContainText('Export queued');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ZIP' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await download.failure()).toBeNull();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
  await expect(page.getByText('Paid subscriptions will be available after billing setup.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('open receipt updates automatically when background extraction completes', async ({ page }) => {
  let signedIn = false;
  let receipt: any = null;
  let receiptListReads = 0;
  let original: Buffer = Buffer.alloc(0);
  const id = randomUUID();
  const captured = () => ({
    id,
    filename: 'home-depot.jpg',
    mime: 'image/jpeg',
    state: 'captured',
    fields: {merchant:'',date:'',subtotal:null,tax:null,tip:null,total:null,currency:'CAD',category:'Uncategorized'},
    original: null,
    confidence: {},
    warnings: [],
    error: null,
    version: 1,
    duplicate_of: null,
    confirmed_at: null,
    created: new Date().toISOString(),
  });
  const extracted = () => ({
    ...captured(),
    state: 'needs_review',
    fields: {merchant:'The Home Depot',date:'2026-09-12',subtotal:1125,tax:146,tip:null,total:1271,currency:'CAD',category:'Office supplies'},
    original: {merchant:'The Home Depot',date:'2026-09-12',subtotal:1125,tax:146,tip:null,total:1271,currency:'CAD',category:'Office supplies'},
    confidence: {merchant:0.99,total:0.98},
    version: 2,
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const send = (value: unknown, status = 200) => route.fulfill({status,json:value});
    if (pathname === '/api/auth/register') { signedIn = true; return send({ok:true}); }
    if (!signedIn) return send({error:'Please sign in.'}, 401);
    if (pathname === '/api/me') return send({user:{name:'Alex',email:'alex@example.ca'},workspace:{name:'Studio',forwarding:null},quota:{plan:'free',used:receipt?1:0,limit:25,period:'lifetime',canUpload:true},billingAvailable:false,hasCustomer:false,hasSubscription:false,extractionAvailable:true,notifications:[]});
    if (pathname === '/api/receipts') {
      if (!receipt) return send([]);
      receiptListReads += 1;
      if (receiptListReads > 1) receipt = extracted();
      return send([receipt]);
    }
    if (pathname === '/api/exports') return send([]);
    if (pathname === '/api/uploads') return send({id,url:`${url.origin}/test-storage/auto-upload`});
    if (pathname === `/api/uploads/${id}/complete`) { receipt = captured(); return send({id,duplicate:false}); }
    if (pathname === `/api/receipts/${id}/link`) return send({url:`${url.origin}/test-storage/auto-original`});
    if (pathname === `/api/receipts/${id}`) return send(receipt);
    return send({error:`Unexpected request ${route.request().method()} ${pathname}`}, 500);
  });
  await page.route('**/test-storage/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/auto-upload')) {
      original = route.request().postDataBuffer()!;
      return route.fulfill({status:200,body:'{}'});
    }
    return route.fulfill({status:200,contentType:'image/jpeg',body:original});
  });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Alex');
  await page.getByLabel('Business name').fill('Studio');
  await page.getByLabel('Email address').fill(`${randomUUID()}@example.ca`);
  await page.getByLabel('Password', {exact:true}).fill('a very long password');
  await page.getByRole('button', {name:'Create your account'}).click();
  const bytes = await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).jpeg().toBuffer();
  await page.locator('input[type=file]').first().setInputFiles({name:'home-depot.jpg',mimeType:'image/jpeg',buffer:bytes});
  await expect(page.getByRole('heading', {name:'Review receipt',exact:true})).toBeVisible();
  await expect(page.getByLabel('Merchant', {exact:true})).toHaveValue('The Home Depot', {timeout:10000});
  await expect(page.getByLabel('Receipt date')).toHaveValue('2026-09-12');
  await expect(page.getByLabel('Subtotal', {exact:true})).toHaveValue('11.25');
  await expect(page.getByLabel('Sales tax', {exact:true})).toHaveValue('1.46');
  await expect(page.getByLabel('Total', {exact:true})).toHaveValue('12.71');
  await expect(page.locator('.page-heading .status')).toHaveText('needs review');
});

test('Supabase email confirmation is shown before entering the workspace', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status:route.request().url().includes('/auth/register') ? 201 : 401, json:route.request().url().includes('/auth/register') ? {ok:true,confirmationRequired:true} : {error:'Please sign in.'} }));
  await page.goto('/');
  await page.getByLabel('Your name').fill('Alex'); await page.getByLabel('Business name').fill('Studio');
  await page.getByLabel('Email address').fill('alex@example.ca'); await page.getByLabel('Password', {exact:true}).fill('a very long password');
  await page.getByRole('button', {name:'Create your account'}).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
});

test('manual edits survive while untouched fields update from queued extraction', async ({ page }) => {
  let signedIn = false;
  let receipt: any = null;
  let receiptReads = 0;
  const id = randomUUID();
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();
    const send = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (pathname === '/api/auth/register') { signedIn = true; return send({ ok: true }); }
    if (!signedIn) return send({ error: 'Please sign in.' }, 401);
    if (pathname === '/api/me') return send({ user: {name:'Alex Morgan',email:'alex@example.ca'}, workspace:{name:'Northline Studio',forwarding:null}, quota:{plan:'free',used:receipt ? 1 : 0,limit:25,period:'lifetime',canUpload:true}, billingAvailable:false,hasCustomer:false,hasSubscription:false,extractionAvailable:true,notifications:[] });
    if (pathname === '/api/receipts') {
      receiptReads += 1;
      if (receipt && receiptReads > 2) receipt = {...receipt, state:'needs_review', fields:{merchant:'Maple Cafe',date:'2026-09-12',subtotal:1000,tax:130,tip:200,total:1330,currency:'CAD',category:'Meals & entertainment'}, confidence:{merchant:0.99,date:0.98,subtotal:0.97,tax:0.96,tip:0.95,total:0.99,currency:0.99,category:0.9},warnings:[]};
      return send(receipt ? [receipt] : []);
    }
    if (pathname === '/api/exports') return send([]);
    if (pathname === '/api/uploads') return send({ id, url: `${url.origin}/test-storage/upload` });
    if (pathname === `/api/uploads/${id}/complete`) {
      receipt = { id,filename:'cafe.png',mime:'image/png',state:'captured',fields:{merchant:'',date:'',subtotal:null,tax:null,tip:null,total:null,currency:'CAD',category:'Uncategorized'},original:null,confidence:{},warnings:[],error:null,version:1,duplicate_of:null,confirmed_at:null,created:new Date().toISOString() };
      return send({ id, duplicate:false });
    }
    if (pathname === `/api/receipts/${id}/link`) return send({ url:`${url.origin}/test-storage/original` });
    if (pathname === `/api/receipts/${id}`) return send(receipt);
    return send({error:`Unexpected test request ${method} ${pathname}`},500);
  });
  await page.route('**/test-storage/**', async route => route.fulfill({status:200,contentType:'image/png',body:'test'}));
  await page.goto('/');
  await page.getByLabel('Your name').fill('Alex Morgan');
  await page.getByLabel('Business name').fill('Northline Studio');
  await page.getByLabel('Email address').fill(`${randomUUID()}@example.ca`);
  await page.getByLabel('Password', { exact: true }).fill('my long test password');
  await page.getByRole('button', { name: 'Create your account' }).click();
  await expect(page.getByRole('heading', { name: 'Your receipts', exact: true })).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'cafe.png', mimeType: 'image/png', buffer: Buffer.from('receipt') });
  await expect(page.getByRole('heading', { name: 'Review receipt', exact: true })).toBeVisible();
  await page.getByLabel('Merchant', { exact: true }).fill('My correction');
  await expect(page.locator('.page-heading .status')).toHaveText('needs review', {timeout:10000});
  await expect(page.getByLabel('Merchant', { exact: true })).toHaveValue('My correction');
  await expect(page.getByLabel('Receipt date')).toHaveValue('2026-09-12');
  await expect(page.getByLabel('Total', { exact: true })).toHaveValue('13.3');
});
