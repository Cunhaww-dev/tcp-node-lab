# 🛰️ Laboratório de Redes, Sessões e Segurança (TCP/IP + Node.js na AWS)

Laboratório prático onde eu construo uma aplicação de autenticação de propósito **insegura**, ataco a mim mesmo pra provar a falha, e depois corrijo camada por camada até chegar numa arquitetura de produção na AWS.

O objetivo não é a aplicação em si (ela é mínima), é **entender na prática** por que certas decisões de rede e segurança importam, sentindo o problema antes de aplicar a solução.

> Exercício inspirado num roteiro de estudos do meu mentor, originalmente em Java. Refiz inteiro em Node.js e estendi com uma arquitetura real de containers na AWS (ECR + ECS Fargate + Application Load Balancer).

---

## 🧰 Stack

- **Node.js** com os módulos nativos `net`, `tls` e `crypto` (sem framework, pra trabalhar o socket cru)
- **Docker** para empacotamento
- **AWS**: EC2, ECR, ECS Fargate, Application Load Balancer, Target Groups, Security Groups
- **tcpdump** para a análise de tráfego de rede

---

## 🗺️ As 4 fases

O projeto foi construído em fases incrementais, cada uma adicionando uma camada de complexidade.

### Fase 1 — Empacotamento (Docker)

Um servidor TCP cru em Node (módulo `net`), que responde um `/login` gerando um token de sessão e um `/dashboard` protegido por esse token. As sessões ficam guardadas em memória (um `Map`). Tudo empacotado numa imagem Docker.

### Fase 2 — Infraestrutura na AWS

A aplicação sobe numa instância EC2, com o Security Group liberando a porta da aplicação (8080) para a internet e o SSH (22) restrito ao meu IP. Primeiro contato com a app rodando publicamente.

### Fase 3 — O ataque (sniffing + session hijacking)

Com a aplicação trafegando em **HTTP puro**, usei o `tcpdump` para farejar a rede e capturar o token de sessão viajando **em texto claro**. Com o token em mãos, acessei a área protegida me passando por outro usuário, sem senha nenhuma. Isso é **session hijacking**.

```
# o token aparecia legível no tráfego capturado:
login ok
token=3d14a27b-7453-48fa-a3f2-370f649fecf0
```

### Fase 4 — A defesa (em 3 níveis)

**Nível 1 — Infraestrutura:** fechei a porta da aplicação no Security Group para aceitar apenas o meu IP, reduzindo a superfície de ataque.

**Nível 2 — Criptografia (TLS):** troquei o módulo `net` pelo `tls` no código (o equivalente a trocar `ServerSocket` por `SSLServerSocket` no mundo Java). Repeti o mesmo ataque da Fase 3, e desta vez o token **não aparecia mais**, só bytes embaralhados. A prova prática da diferença entre `http` e `https`.

```
# com TLS, o mesmo ataque capturava apenas lixo criptografado:
2b22 815e b64f c218 698a 741c 72a5 99c2
53c0 321d d0e3 b80a 1acc 03d2 dd44 aefa
```

**Nível 3 — Arquitetura distribuída:** subi a aplicação em **2 containers** no ECS Fargate, atrás de um Application Load Balancer. Aqui apareceu um bug clássico: como cada container guarda as sessões na **própria memória**, um token criado no container A não é reconhecido pelo container B. O mesmo token funcionava ou falhava dependendo de qual container o Load Balancer escolhia.

```
# mesmo token, resultado diferente conforme o container que respondeu:
/dashboard -> container A -> area logada de fabri      (ok)
/dashboard -> container B -> token invalido            (falha)
```

Corrigi ativando **Sticky Sessions** no Target Group, que gruda cada cliente a um container fixo durante a sessão. Depois disso, o mesmo token passou a funcionar sempre.

---

## 🏛️ Arquitetura final

```
Internet
   │
   ▼
Application Load Balancer  (distribui a carga + sticky sessions)
   │
   ▼
Target Group  (lista dos containers saudáveis)
   │
   ├──► Container A  (ECS Fargate)  ── sessões em memória local
   └──► Container B  (ECS Fargate)  ── sessões em memória local

Imagem Docker servida pelo Amazon ECR
```

---

## 💡 Principais aprendizados

- **Por que HTTPS importa, na prática.** Dado em texto puro pode ser lido por qualquer um no caminho dos pacotes (Wi-Fi público, rede comprometida). O TLS resolve isso embaralhando o conteúdo. Não é teoria, eu vi o token sumir do tráfego.

- **Onde o TLS "mora" depende da arquitetura.** Com um servidor só, o TLS vai no código da aplicação. Com um Load Balancer na frente, o padrão de produção é fazer a **terminação de TLS no alb**, que protege o trecho público (internet → alb), enquanto o trecho interno roda em rede privada.

- **Estado em memória não escala.** Guardar sessão na memória do processo funciona com um container, mas quebra assim que você escala horizontalmente. A solução de verdade é tornar a aplicação **stateless**, externalizando a sessão (ex: Redis). Sticky Sessions resolve o sintoma, mas é um paliativo.

- **Security Groups são firewalls por camada.** Cada peça (EC2, Load Balancer, containers) tem o seu, e o tráfego atravessa todos em sequência. Entender "qual porta, para quem" é fundamental.

- **Porta é convenção, não regra.** O número da porta só diz qual serviço responde; quem pode acessá-la é decidido no firewall.

- **Diferença Stateful e Stateless.** Aplicação que guarda estado na própria memória é stateful, o problema é que memória não escala horizontalmente, não vai funcionar quando tivermos mais instâncias da aplicação. O ideal é ela se stateless (sem estado), onde qualquer container atende qualquer requisição sem depender do que ficou guardado nele

- **Sticky Sessions é paliativo, não solução.** Configuramos o ALB para grudar cada usuário num container fixo: se o balanceador direcionou alguém para o container 1, ele fica lá pelo resto da sessão. Isso tem dois problemas sérios. Se o container 1 cair, todo mundo preso nele perde a sessão de uma vez. E a distribuição pode ficar desigual, com um container lotado enquanto o outro fica à toa. Ou seja, usar sticky é continuar _stateful_, só escondendo o problema. O correto aqui seria usar uma **sessão externa**, como o Redis. Assim todos os containers consultam o mesmo Redis, e tanto faz se a requisição cai no container 1 ou no 2, os dois enxergam a mesma sessão. A aplicação vira _stateless_ e escala de verdade seja com 10 ou 100 containers, todos funcionam igual.

---

## ⚠️ Aviso

Este é um projeto **estritamente educacional**. As técnicas de interceptação de rede foram usadas exclusivamente no meu próprio ambiente de laboratório. A aplicação é intencionalmente insegura em suas fases iniciais e **não deve ser usada como base para nada em produção**.
