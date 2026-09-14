/** Browser contracts for receipt extraction, manual review, and auth with mocked hosted services. */
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
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
      receipt ||= { id,filename:'cafe.png',mime:'image/png',state:'failed',fields:{merchant:'',date:'',subtotal:null,tax:null,tip:null,total:null,currency:'CAD',category:'Uncategorized'}, original:null,confidence:{},warnings:[],error:'Automatic extraction is not configured. Enter the details manually.',version:1,duplicate_of:null,approved_at:null,created:new Date().toISOString() };
      return send({ id, duplicate });
    }
    if (pathname === `/api/receipts/${id}/link`) return send({ url:`${url.origin}/test-storage/original` });
    if (pathname === `/api/receipts/${id}` && method === 'PUT') { receipt = {...receipt,fields:route.request().postDataJSON().fields,state:'needs_review',error:null,version:receipt.version+1}; return send(receipt); }
    if (pathname === `/api/receipts/${id}/approve`) { receipt = {...receipt,state:'approved',approved_at:new Date().toISOString(),version:receipt.version+1}; return send(receipt); }
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
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your receipts', exact: true })).toBeVisible();
  expect((await page.locator('.capture-card').boundingBox())!.height).toBeLessThan(350);
  await page.screenshot({ path: `test-results/${info.project.name}-workspace.png`, fullPage: true });
  const bytes = await sharp(Buffer.from('<svg width="420" height="650" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="650" fill="#fffdf8"/><g fill="#333" font-family="sans-serif"><text x="80" y="80" font-size="28">MAPLE CAFE</text><text x="80" y="140" font-size="18">September 12, 2026</text><text x="60" y="250" font-size="20">Subtotal             $10.00</text><text x="60" y="300" font-size="20">HST                     $1.30</text><text x="60" y="350" font-size="20">Tip                       $2.00</text><text x="60" y="430" font-size="24">TOTAL CAD      $13.30</text></g></svg>')).png().toBuffer();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'cafe.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.getByRole('heading', { name: 'Review receipt', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to receipts' }).click();
  await expect(page.getByRole('button', { name: /cafe.png/ })).toContainText('failed', { timeout: 15000 });
  await page.getByRole('button', { name: /cafe.png/ }).click();
  await expect(page.getByText('Automatic extraction is not configured.', { exact: false })).toBeVisible();
  await page.getByLabel('Merchant', { exact: true }).fill('Maple Café');
  await page.getByLabel('Receipt date').fill('2026-09-12');
  await page.getByLabel('Subtotal', { exact: true }).fill('10');
  await page.getByLabel('Sales tax', { exact: true }).fill('1.30');
  await page.getByLabel('Tip', { exact: true }).fill('2');
  await page.getByLabel('Total', { exact: true }).fill('13.30');
  await expect(page.getByRole('button', { name: 'Approve receipt', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve receipt', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Approve receipt', exact: true }).click();
  await expect(page.locator('.page-heading .status')).toHaveText('approved');
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
    approved_at: null,
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
  await page.getByRole('button', {name:'Create your workspace'}).click();
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
  await page.getByRole('button', {name:'Create your workspace'}).click();
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
      receipt = { id,filename:'cafe.png',mime:'image/png',state:'captured',fields:{merchant:'',date:'',subtotal:null,tax:null,tip:null,total:null,currency:'CAD',category:'Uncategorized'},original:null,confidence:{},warnings:[],error:null,version:1,duplicate_of:null,approved_at:null,created:new Date().toISOString() };
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
  await page.getByRole('button', { name: 'Create your workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Your receipts', exact: true })).toBeVisible();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'cafe.png', mimeType: 'image/png', buffer: Buffer.from('receipt') });
  await expect(page.getByRole('heading', { name: 'Review receipt', exact: true })).toBeVisible();
  await page.getByLabel('Merchant', { exact: true }).fill('My correction');
  await expect(page.locator('.page-heading .status')).toHaveText('needs review', {timeout:10000});
  await expect(page.getByLabel('Merchant', { exact: true })).toHaveValue('My correction');
  await expect(page.getByLabel('Receipt date')).toHaveValue('2026-09-12');
  await expect(page.getByLabel('Total', { exact: true })).toHaveValue('13.3');
});
