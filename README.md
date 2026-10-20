# GKE Subnet Calculator

Web app **statica** (HTML + CSS + JS, nessun backend) che calcola il
dimensionamento delle subnet per un cluster GKE VPC-native.

Le formule sono allineate alla documentazione ufficiale Google Kubernetes Engine:
<https://docs.cloud.google.com/kubernetes-engine/docs/how-to/flexible-pod-cidr>

## Contenuto

| File | Descrizione |
|---|---|
| `index.html` | Interfaccia (input, risultati, tabelle di riferimento) |
| `calculator.js` | Logica di calcolo (funzioni di dominio allineate alla doc GKE) |

Non ci sono dipendenze esterne: tutto gira nel browser, nessun dato esce dalla pagina.

## Formule applicate

Con `Q` = max Pod per nodo, `S` = prefisso subnet principale, `DS` = prefisso subnet Pod:

```
M  = 31 - ceil(log2(Q))     # CIDR per nodo
HM = 32 - M                 # bit host per nodo
HD = 32 - DS                # bit host intervallo Pod
MN = 2^(HD - HM)            # max nodi
MP = MN * Q                 # max pod
N  = 2^(32 - S) - 4         # IP utilizzabili subnet principale (4 riservati GCP)
```

Vincoli GKE applicati: `Q` massimo 512; intervallo Pod di un node pool mai piu'
piccolo di `/24`; intervallo Service minimo `/28`.

## Sviluppo locale

Apri direttamente `index.html` nel browser, oppure servi la cartella:

```bash
cd gke-subnet-calculator
python3 -m http.server 8080
# http://localhost:8080
```

## Deploy su bucket Google Cloud Storage

Prerequisiti: `gcloud` / `gsutil` configurati, un progetto GCP e un nome bucket
univoco globale.

```bash
BUCKET=gs://gke-subnet-calculator-<suffisso-univoco>

# 1. crea il bucket
gsutil mb -l europe-west8 "$BUCKET"

# 2. carica i file statici
gsutil -m cp index.html calculator.js "$BUCKET/"

# 3. configura index.html come pagina predefinita
gsutil web set -m index.html "$BUCKET"

# 4a. sito pubblico (accesso anonimo in lettura)
gsutil iam ch allUsers:objectViewer "$BUCKET"
```

URL diretto del bucket:
`https://storage.googleapis.com/<nome-bucket>/index.html`

### Dominio / HTTPS personalizzato

Per un dominio custom con HTTPS, metti davanti al bucket un **HTTP(S) Load
Balancer** con backend bucket e certificato gestito Google. L'endpoint diretto
`storage.googleapis.com` resta comunque disponibile su HTTPS.

### Accesso privato (solo organizzazione)

Salta il passo 4a e concedi l'accesso solo ai principali desiderati, ad esempio:

```bash
gsutil iam ch group:team@nttdata.com:objectViewer "$BUCKET"
```

In questo caso serve un Load Balancer con IAP, oppure l'accesso autenticato via
console/`gsutil`, perche' `storage.googleapis.com` da solo non applica il login.

## Licenza

Distribuito con licenza [0BSD (Zero-Clause BSD)](LICENSE), una licenza open
source approvata OSI tra le piu' permissive esistenti: consente uso, copia,
modifica e distribuzione per qualsiasi scopo, senza alcun obbligo di
attribuzione o di mantenere la nota di copyright.
# GkeSubnetCalculator
