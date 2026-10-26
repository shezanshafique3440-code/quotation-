# Windows par local testing

Is package mein latest, abhi tak GitHub par push na ki gayi changes hain.
Windows par aapki testing ke baad hi push kiya jayega. ZIP mein credentials,
database, `node_modules` aur Git authentication shamil nahi hain.

## 1. Node aur folder tayyar karein

1. [Node.js ki official website](https://nodejs.org/en/download) se **Node.js 24 LTS** install karein.
2. ZIP ko ek naye folder mein extract karein, misal ke taur par
   `C:\Projects\quotation-local`. Isi folder mein `package.json` hona chahiye.
3. Folder mein PowerShell ya Windows Terminal kholein. Check karein:

```powershell
node --version
```

Version `v24.` se shuru honi chahiye. `npm.cmd` use karne se PowerShell ki npm
script execution-policy wali rukawat se bacha ja sakta hai.

## 2. Setup karein

```powershell
npm.cmd run setup:local -- --mail
```

Ye locked dependencies install karega, local `.env` mein session aur maintenance
keys banayega, SQLite schema tayyar karega aur Free/Pro demo data load karega.
Maujooda nonblank keys aur demo data dobara chalane par retain hotay hain.
Setup ko pehli dafa packages, Prisma engines aur Google Fonts download karne
ke liye internet chahiye. Docker, Python aur live provider keys zaroori nahi.

## 3. App, inbox aur scheduler start karein

```powershell
npm.cmd run dev:local
```

Jab `Local app, email inbox and hourly maintenance are ready` nazar aaye,
apne computer ke browser mein ye addresses kholein:

```text
App:   http://localhost:3000
Inbox: http://127.0.0.1:8025
```

Ye local addresses aapke Windows computer ke liye hain. Pehla terminal khula
rakhein. `Ctrl+C` app, inbox aur isi command ke scheduler ko band karta hai.
Inbox memory mein rehta hai; band hone par captured messages chali jati hain.

## 4. Automatic flow test karein

Isi folder mein doosra terminal kholein:

```powershell
npm.cmd run test:local
```

Successful run mein `PASS` aaye ga:

- Local application aur SMTP inbox ready.
- Naya test account, verification email aur address confirmation.
- Password reset email, purane password ka reject hona aur purani session ka revoke hona.
- Quotation email ka SMTP par accept hona, delivery record aur customer share page.
- Sirf isi run ke test account/workspace ka cleanup.

Ye command unique temporary account banati hai; aapke demo aur personal records
ko delete nahi karti. Test emails inbox mein rehti hain jab tak inbox band na ho.

## 5. Khud browser mein test karein

| Demo | Email | Password | Kis liye |
| --- | --- | --- | --- |
| Free | `owner@northline.test` | `northline-demo-2026` | Existing quotations, PDFs, analytics aur Free limits. |
| Local Pro | `pro-owner@quoteflow.test` | `quoteflow-local-pro-2026` | Teammates, invitations, branding aur Pro limits. |

Local Pro ek seed fixture hai; is ke liye Stripe payment nahi hui. Real billing
ka upgrade sirf verified Stripe webhook se hi hota hai.

1. Local Pro account se sign in karein. Verification banner se email mangwayein,
   inbox mein link kholein aur confirmation button dabayein.
2. Catalog aur inquiry kholein. Seed product PKR 1,000, tax 10% hai. Ek service
   ki quotation ka total PKR 1,100 hona chahiye.
3. Quotation banayein; notes, terms, discount aur signature option check karein.
   PDF download karke title, amounts aur dates dekhein.
4. Customer address `customer@example.test` par quotation email bhejein. Email
   inbox mein milni chahiye. Link ko private/incognito window mein khol kar
   accept/decline aur optional signature test karein.
5. App mein status aur timeline update dekhein. Decision ke baad pending
   follow-up cancel hona chahiye.
6. Search customers, inquiries aur quotations; status filter aur pagination dekhein.
7. Pro account se business colour/logo/portal copy change karke public page
   check karein. Team invite `teammate@example.test` ko bhejein, inbox se link
   private window mein khol kar doosra account join karwayein.
8. Forgot password se email mangwa kar reset karein. Naye password se sign in
   hona chahiye; purana password/session kaam nahi karna chahiye.

Maintenance foran chalani ho:

```powershell
npm.cmd run maintenance
```

`dev:local` ka scheduler start par aur phir har ghante maintenance chalata hai.
Expiry aur due follow-up digests local inbox mein test ho sakte hain. Terminal
band ho to schedule nahi chalta; hosted schedule is local testing ka hissa nahi.

Developer checks, isi folder mein:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
```

Build check ke liye pehle pehle terminal mein `Ctrl+C` se development stack band
karein, kyun ke dev aur build `.next` folder share karte hain:

```powershell
npm.cmd run build
```

Phir `npm.cmd run dev:local` se testing dobara start kar sakte hain.

## Agar rukawat aaye

- Port 3000, 1025 ya 8025 busy ho to pehle purani local app/inbox band karein.
  Launcher occupied service ko reuse ya automatically terminate nahi karta.
- Mail capture ke liye setup mein `--mail` zaroor dein. Agar existing live SMTP
  credentials ka conflict aaye to ZIP ko naye local folder mein extract karein;
  live configuration ko overwrite na karein.
- Node version change karne ke baad terminal dobara kholein aur setup rerun karein.
- Login password pehle change kiya ho to seed usay reset nahi karega. Local inbox
  ke saath Forgot password use karein.
- Error aaye to command ka naam aur error text share karein; `.env` file, keys,
  session cookies ya emailed token links chat mein paste na karein.

Local launcher sirf loopback par bind hota hai aur repeated smoke runs ke liye
apne child processes mein forwarded-IP buckets enable karta hai. Persisted
`.env` aur normal `npm run dev` ki proxy policy alag se retain hoti hai.

## Live keys baad mein

AI aur Stripe local setup mein off rehte hain. Captured SMTP emails external
inboxes tak nahi jati. Live Anthropic/email/Stripe credentials, real payment
testing, HTTPS deployment aur hosted schedule baad mein configure honge.
Abhi koi GitHub push nahi kiya gaya.
