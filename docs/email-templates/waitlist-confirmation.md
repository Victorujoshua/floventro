# Email Template: waitlist-confirmation

**Alias:** `waitlist-confirmation`  
**Provider:** ZeptoMail  
**Trigger:** Successful new waitlist signup via `POST /api/waitlist`

## Purpose

Confirms the subscriber is on the Floventro waitlist and sets expectations.

## Required merge fields

| Field        | Description                         | Example     |
|--------------|-------------------------------------|-------------|
| `first_name` | First name extracted from full name | `Olawale`   |

Fallback: `there` (e.g. "Hi there,") when full name is not provided.

## Suggested content

**Subject:** You're on the Floventro waitlist.

**Body:**

> Hi {{first_name}},
>
> You're on the list. We'll reach out when Floventro is ready for your first cohort.
>
> In the meantime, if you have questions or want to share what you're building, reply directly to this email.
>
> — The Floventro team

## From address

`hello@floventro.com` — ensure SPF and DKIM are configured for this domain in ZeptoMail before go-live.
