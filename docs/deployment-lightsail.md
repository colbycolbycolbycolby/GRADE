# GRADE Lightsail dogfooding runbook

Status: Phase 2.6A preparation only. **Do not run this until deployment is separately approved.**

This runbook targets the verified Ubuntu 24.04 CVM Lightsail host. GRADE remains an independent
application: user `grade`, checkout `/opt/grade/app`, virtual environment `/opt/grade/venv`, data
under `/var/lib/grade`, and loopback-only HTTP on `127.0.0.1:8000`. The initial resource limits are
dogfooding guardrails, not measured production requirements.

## 1. Preserve the current instructor work

Before changing any server or browser:

1. From the current localhost GRADE origin, export the corrected Pitbull and S&M programs.
2. Keep two copies of each `.grade.json` file in different locations.
3. Inspect the S&M export and confirm its `program.segments` array contains the six expected
   instructor-defined sections.
4. Back up the current server `GRADE_DATA_DIR` as one consistent unit, including `grade.sqlite3`
   and `audio/`. Stop the local GRADE server while taking a filesystem copy of SQLite and audio.
5. Do not clear the localhost origin's IndexedDB or remove its server data until import on the
   hosted origin has been verified.

Program import requires the destination server to contain the referenced track and analysis. The
browser export does not contain audio, class plans, settings, or the whole IndexedDB database.

## 2. Record the CVM baseline

Before installing GRADE, record—not change—the status and next trigger time of every `cvm-*` timer,
recent CVM unit results, available memory, swap, load, and disk. Take or verify a recoverable
Lightsail snapshot according to the approved CVM procedure. Do not copy credentials or environment
values into deployment notes.

## 3. Create the isolated account and directories

Run only after checking that the names and paths are unused:

```sh
sudo adduser --system --group --home /var/lib/grade --no-create-home grade
sudo install -d -o grade -g grade -m 0750 /opt/grade
sudo install -d -o grade -g grade -m 0750 /opt/grade/app
sudo install -d -o grade -g grade -m 0750 /opt/grade/venv
sudo install -d -o grade -g grade -m 0750 /var/lib/grade
sudo install -d -o root -g grade -m 0750 /etc/grade
```

Deploy a reviewed GRADE source revision into `/opt/grade/app` without copying the development
`.venv`, `node_modules`, `apps/server/data`, or browser data. The repository currently has no Git
remote, so the transfer method and integrity check must be selected and documented before this step.
All deployed application files should be owned by `grade:grade`; only `/var/lib/grade` is runtime
writable by the service.

## 4. Install the runtime and build artifacts

On Ubuntu 24.04, verify package candidates before installation, then install the OS runtime:

```sh
apt-cache policy python3 python3-venv ffmpeg
sudo apt-get update
sudo apt-get install --no-install-recommends python3 python3-venv ffmpeg ca-certificates
python3 --version
ffmpeg -version
ffprobe -version
```

Python must be 3.11 or newer. Install a reviewed, pinned `uv` release by its official installation
method and record its version. Then create the external environment from the committed lockfile:

```sh
sudo -u grade env UV_PROJECT_ENVIRONMENT=/opt/grade/venv \
  uv sync --project /opt/grade/app/apps/server --frozen --no-dev
/opt/grade/venv/bin/python --version
/opt/grade/venv/bin/uvicorn --version
```

Build the web assets on a trusted build machine using the committed pnpm lockfile; Node and pnpm are
not runtime dependencies on Lightsail:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @grade/web build
test -f apps/web/dist/index.html
```

Transfer the reviewed source plus `apps/web/dist` to `/opt/grade/app`. Confirm the deployed build is
owned by `grade:grade` and is not writable by the web proxy user.

## 5. Install external configuration

Copy `deploy/grade.env.example` to `/etc/grade/grade.env`, then keep it root-owned:

```sh
sudo install -o root -g grade -m 0640 /opt/grade/app/deploy/grade.env.example \
  /etc/grade/grade.env
sudoedit /etc/grade/grade.env
```

The initial values are:

```text
GRADE_DATA_DIR=/var/lib/grade
GRADE_WEB_DIR=/opt/grade/app/apps/web/dist
GRADE_MAX_ACTIVE_JOBS=1
```

`GRADE_WEB_DIR` is explicit for operational clarity but is not required by the application: in this
layout its code-derived default is already `/opt/grade/app/apps/web/dist`. Do not set
`GRADE_ALLOWED_ORIGINS` for a same-origin reverse-proxy deployment.

## 6. Add emergency swap

The host has 1.9 GiB RAM and no swap. After confirming `/swapfile` does not exist and sufficient disk
remains, create a 2 GiB emergency swap file:

```sh
sudo test ! -e /swapfile
sudo fallocate -l 2G /swapfile
sudo chmod 0600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
swapon --show
free -h
```

Add exactly one `/swapfile none swap sw 0 0` entry to `/etc/fstab`, then validate with
`sudo findmnt --verify`. Swap is an emergency buffer, not capacity for normal analysis.

## 7. Install the GRADE service

Inspect the unit, then verify it with the target host's systemd before enabling it:

```sh
sudo install -o root -g root -m 0644 /opt/grade/app/deploy/systemd/grade.service \
  /etc/systemd/system/grade.service
sudo systemd-analyze verify /etc/systemd/system/grade.service
sudo systemctl daemon-reload
sudo systemctl enable grade.service
```

The unit binds Uvicorn only to `127.0.0.1:8000`, uses the external virtual environment and data
directory, makes the system filesystem read-only except for `/var/lib/grade`, and makes
`/opt/cvm-poc` inaccessible inside the service. Its initial limits are one CPU, `MemoryHigh=900M`,
and `MemoryMax=1200M`. Do not loosen these without measurements.

Before adding a public route, start GRADE and verify locally:

```sh
sudo systemctl start grade.service
systemctl status grade.service --no-pager
curl --fail --silent --show-error http://127.0.0.1:8000/ >/dev/null
sudo ss -ltnp
```

There must be no listener for GRADE on `0.0.0.0:8000` or `[::]:8000`.

## 8. Add Caddy, HTTPS, and access control

Install a reviewed Caddy package using current official Ubuntu instructions. Record `caddy version`
and verify that the installed version supports the directives in `deploy/Caddyfile.example`.

1. Create the GRADE DNS record pointing to the Lightsail static IP.
2. Generate a password hash on the server with `caddy hash-password`; never commit or log the
   password or final hash.
3. Install `deploy/caddy.env.example` as `/etc/caddy/grade.env` owned by root with mode `0600`,
   replace its marker with the final hash, and install `deploy/systemd/caddy-grade.conf` as the
   Caddy service drop-in `/etc/systemd/system/caddy.service.d/grade.conf`. Run
   `systemctl daemon-reload` after validating both files. This supplies the hash referenced by the
   example without putting it in the checkout or Caddyfile.
4. Adapt and validate the final configuration with the installed Caddy binary before reloading it.
5. Proxy only to `127.0.0.1:8000` and confirm automatic HTTPS succeeds.
6. Test authentication in normal Safari and in an installed iPhone PWA. If HTTP Basic credentials
   are not retained reliably by the installed PWA, stop and choose a reviewed access-control layer;
   do not expose unauthenticated GRADE as a workaround.

The example intentionally has no special audio rule: Caddy passes Range requests through to
FastAPI. Test `206 Partial Content` after installation.

## 9. Restrict networking

In the Lightsail firewall, retain SSH only from its approved source range where practical, and add
only TCP 80 and 443 for Caddy. Do not open 8000 or 8080. Confirm both the Lightsail firewall and the
host's active firewall state rather than assuming one replaces the other.

External checks must show only the approved SSH/HTTP/HTTPS exposure. Local checks should show
Uvicorn on `127.0.0.1:8000` and Caddy on the public HTTP/HTTPS sockets.

## 10. Prove isolation and resource behavior

Before iPhone dogfooding:

1. Confirm the GRADE process runs as `grade`, not `ubuntu`, root, or `cvm-poc`.
2. Confirm GRADE can write `/var/lib/grade` and cannot access `/opt/cvm-poc` from its service
   namespace.
3. Record `systemctl show grade.service` resource settings and the cgroup's idle memory.
4. Analyze one normal song, then one near the 15-minute limit.
5. During each run, record cgroup peak memory, CPU, swap use, duration, and journal errors.
6. While one analysis is held active, submit a different track. It must return HTTP 429 with
   `too_many_jobs`. A repeat request for the same track must return the original job ID.
7. Confirm only one `grade-job` worker performs analysis and GRADE stays inside its cgroup limits.
8. Confirm the CVM timers remain enabled, their next trigger times are unchanged, and runs during or
   after the load test succeed without unusual delay.
9. Restart and stop only `grade.service`; prove CVM units and files remain unaffected.
10. Verify SQLite and audio persist across a GRADE restart.

If one analysis approaches `MemoryMax`, causes sustained swap activity, disrupts a CVM timer, or
causes a system OOM, stop GRADE and move it to a separate instance rather than weakening isolation.

## 11. iPhone handoff

After HTTPS and access control pass, install the PWA on the iPhone, import the matching songs, and
then import the saved Pitbull and S&M program files. Verify the S&M program still has six corrected
sections before using it in a class. Complete `docs/device-checklist.md`; background playback and
installed-PWA authentication remain manual checks.
