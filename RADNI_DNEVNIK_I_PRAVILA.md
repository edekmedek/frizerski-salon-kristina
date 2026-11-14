# Salon Kristina — dnevnik rada i pravila suradnje

Ažurirano: 14.11.2026. Ovaj dokument pročitati na početku sljedećeg rada na projektu, zajedno s `PROJECT_GUIDE.md`. Dokument bilježi korisnički potvrđene rezultate i postupak; nije zamjena za pregled aktualnog koda.

## Kako radimo — obavezno

1. Korisnik opisuje željeni rezultat običnim jezikom. Asistent utvrđuje točnu datoteku i priprema gotovu **jednorednu PowerShell naredbu**; korisnik je izvršava i vraća automatski kopiran rezultat ili sliku.
2. **Svaka PowerShell naredba počinje s `cls;` i na kraju automatski kopira relevantan rezultat u Windows clipboard (`Set-Clipboard`).** Mora biti jedna fizička linija i sintaktički valjana za Windows PowerShell.
3. Prije izmjene napravi sigurnosnu kopiju ciljane datoteke, provjeri da očekivani dio koda postoji i da se promjena ne ponavlja. Po mogućnosti koristi preciznu zamjenu umjesto beskonačnog dodavanja CSS override pravila.
4. Mijenjaj samo traženi dio. Ne diraj rezervacije, podatke klijenata, Supabase, Nuki, Companion, kameru ili druge funkcije bez izričitog zahtjeva.
5. Nakon promjene pokreni primjerene provjere (`npm.cmd run lint`, `npm.cmd run test`, `npm.cmd run build`) i provjeri vizualni rezultat na PC-u i mobitelu. **Build=0 ne dokazuje da UI radi.**
6. **VS Code i Copilot koristiti samo kada PowerShell i dostupni alati nisu razumno dovoljni** (složene nove komponente, veliki refaktori, dublje istraživanje). Ne trošiti Copilot resurse na male CSS/TSX izmjene.
7. Ne objavljivati dok korisnik ne kaže da objavljujemo. Push na `main` automatski pokreće GitHub Pages workflow. Stageati izričito odabrane datoteke, nikada `git add .` bez revizije; ne slati lokalne slike, backup mape, `.env.local`, testne skripte i tajne.
8. Ne tvrditi da je nešto napravljeno dok rezultat nije potvrđen. Ako naredba ne uspije, dati popravljenu naredbu bez kruženja kroz iste dijagnostike.
9. Na kraju svake veće cjeline ažurirati ovaj dnevnik: cilj, izmijenjene datoteke, provjere, poznati rizici, objava.

## Projekt i objava

- Lokalni projekt: `C:\Projekti\FrizerskiSalonKristina`.
- Lokalni pregled: `http://127.0.0.1:5173/`.
- GitHub: `edekmedek/frizerski-salon-kristina`, grana `main`.
- Produkcija: `https://frizerskisalonkristina.hr/`.
- Workflow: `.github/workflows/deploy.yml`: `npm ci`, lint, test, build, GitHub Pages deploy.
- Produkcijske Supabase vrijednosti su GitHub Actions varijable; ne upisivati privilegirane ključeve u frontend.

## Rad 14.11.2026. — naslovnica, galerija, administracija

### Naslovnica

- `src/AccessScreen.tsx`, `src/Portal.css` i povezani stilovi.
- Redizajnirana naslovnica koristi pozadinu `public/salon-hero.jpg`, Kristininu karikaturu `public/kristina-karikatura.jpeg` i devet statičkih fotografija `public/hero-radovi/rad-1.jpg` do `rad-9.jpg`.
- Izvorne fotografije bile su 6 JPG i 3 MP4; FFmpeg je izdvojio kadrove i pripremio lokalne JPEG-ove. Nema Supabase Storage prometa za ovu galeriju.
- Tekst je na vrhu, ispod njega gumbi `Rezerviraj termin` i `Galerija`. Na mobilnom prikazu oba gumba su centrirana jedan uz drugi; korisnik je potvrdio konačni raspored slikom.
- Upozorenje: `Portal.css` sadrži više ranije dodanih override blokova; kod budućeg redizajna treba konsolidirati ciljane stilove, ne gomilati nove `!important` zakrpe.

### Galerija

- Nova komponenta `src/SalonGallery.tsx`, integracija u `src/AccessScreen.tsx`, stilovi u `src/Portal.css`.
- Gumb Galerija otvara fullscreen prikaz devet lokalnih slika. Na mobitelu predviđeni pinch-to-zoom, pomicanje povećane slike i swipe; na PC-u strelice, Esc, brojač i zumiranje.
- Korisnik je potvrdio da galerija radi; ne tvrdimo da je svaka gesta zasebno automatizirano testirana.
- Za izradu komponente korišten je Copilot; za završne dorade gumba korištene su jednoredne PowerShell naredbe.

### Administratorska prijava

- `src/AccessScreen.tsx`, `src/App.tsx`, `src/Portal.css`.
- Javni obrazac prikazuje samo lozinku, bez e-mail polja. Koristi postojeći Supabase Auth račun i dodatnu provjeru `user_roles` za administratorsku ulogu. Lozinku nikada ne zapisivati u repozitorij ili dokumentaciju.
- Reset lozinke preko e-maila je proveden. Prilikom oporavka pojavio se problem s automatskim prebacivanjem sesije; u `App.tsx` dodana je zaštita recovery toka, a zatim i obrada događaja `SIGNED_IN` uz `INITIAL_SESSION`, `TOKEN_REFRESHED`, `SIGNED_OUT`.
- Korisnik je potvrdio uspješnu prijavu.
- Obrazac je vizualno uređen; umjesto slova K koristi se centrirana karikatura, povećana na 104 px; uklonjeni su suvišni naslovi i javni gumb `Zaboravljena lozinka?`. Oporavak je potrebno voditi zasebno; **skrivanje gumba samo po sebi nije sigurnosna zabrana slanja reset e-maila**.

### Provjere i objava

- Prije pusha korisnik je potvrdio `lint=0`, `test=0`, `build=0`, `git add=0`, `commit=0`, `push=0`.
- U commit su ciljano uključene izvorne datoteke, galerija i javne slike; lokalni backupi i testne skripte nisu stageani.
- Push na `main` je uspio. **Završetak GitHub Pages deploymenta nije potvrđen u ovom dnevniku**; po potrebi provjeriti Actions i javnu stranicu.

## Kako započeti sljedeći put

1. Pročitati ovaj dokument i `PROJECT_GUIDE.md`; uzeti korisnikov novi zahtjev.
2. Provjeriti samo relevantne datoteke i `git status --short`; bez široke inventure ako nije potrebna.
3. Pripremiti jednu sigurnu PS naredbu za promjenu, s backupom i clipboardom.
4. Provjeriti build/test i stvarni UI; zatim, samo po odobrenju, selektivni commit/push i potvrdu objave.

## Otvorene napomene

- Provjeriti status završne produkcijske objave ako se to traži.
- `README.md` je još generički Vite tekst; `PROJECT_GUIDE.md` ima stariji checkpoint i treba ga povremeno uskladiti s aktualnim kodom.
- Ne spremati stvarne lozinke, tokene, privatne e-mail adrese ni sadržaj `.env.local` u dokumentaciju.
