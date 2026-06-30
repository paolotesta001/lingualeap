# LinguaLeap as a phone app (PWA on GitHub Pages)

The `docs/` folder is a **fully self-contained, client-side version** of LinguaLeap.
It needs **no Python server** — it runs entirely in the browser, so it can live on
**GitHub Pages** for free and work on your phone even when your PC is off.

What runs where now:

| Feature | How it works in the PWA |
|---|---|
| Dictionary | Calls the free MyMemory API directly from the browser + the bundled local dictionary |
| Add words from Reverso | Upload your Reverso `favourites.csv` (parsed in the browser); your existing one is bundled under "Import from folder" |
| Flashcards, My Words, My Sentences | Stored on your phone (localStorage) |
| Lessons, exercises, placement test | Bundled JSON in `docs/data/` |
| Chatbot & Movie Phrases | Call Google Gemini directly using **your own key**, pasted once in ⚙️ Settings and stored only on your device |
| Progress | Saved on your phone (localStorage) |

> Your Gemini key is **never** put in the code or the repo. You paste it into the
> app's ⚙️ Settings on your phone; it stays in that phone's browser storage.

---

## Fastest path (one command)

The GitHub CLI is already installed. From the `learning_language` folder, run **once**:

```powershell
gh auth login          # pick: GitHub.com -> HTTPS -> Login with a web browser, then authorize
.\publish.ps1          # creates the repo, pushes, enables Pages, prints + opens your live link
```

That's it — `publish.ps1` does everything and prints your URL
(`https://<your-username>.github.io/lingualeap/`). The manual steps below are only
if you prefer doing it by hand.

---

## One-time setup (manual)

### 1. Put the project on GitHub
```bash
cd "learning_language"
git init
git add .
git commit -m "LinguaLeap PWA"
git branch -M main
# create an EMPTY repo on github.com first, then:
git remote add origin https://github.com/<your-username>/lingualeap.git
git push -u origin main
```
`.env` (your local server key) is already git-ignored, so nothing secret is uploaded.

### 2. Turn on GitHub Pages
On github.com → your repo → **Settings → Pages**:

- **Build and deployment → Source: GitHub Actions.**

The included workflow (`.github/workflows/pages.yml`) publishes the `docs/` folder
automatically on every push. After ~1 minute you'll get a URL like:

```
https://<your-username>.github.io/lingualeap/
```

(Alternative without Actions: Source → *Deploy from a branch* → `main` / `/docs`.)

### 3. Install it on your iPhone
1. Open the Pages URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open the new LinguaLeap icon (it runs full-screen, like a native app).
4. Tap **⚙️ Settings** (top-right) → paste your **Gemini API key** → Save.
   - Get a free key at **aistudio.google.com/apikey**.
   - Needed only for Chatbot and Movie Phrases; everything else works without it.

Done — it now works anytime, with your PC off.

---

## Updating content later
Edit files in `docs/` (or re-copy data from the Flask app), then:
```bash
git add . && git commit -m "update" && git push
```
Pages redeploys automatically. On the phone, fully close and reopen the app to pick
up the new version (the service worker refreshes in the background).

## Test locally before pushing
```bash
cd docs
python -m http.server 8080
# open http://localhost:8080
```

## The original Flask app
`app.py` and `templates/` are untouched — keep using `python app.py` on your PC for
development. The `docs/` PWA is an independent, deployable copy.
