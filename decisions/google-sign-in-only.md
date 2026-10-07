---
title: Article Studio has Google sign-in for designally.co accounts only, and everyone is an admin
app: article-studio
decided:
author: ai
sources:
  - https://github.com/designally-co/article-studio/blob/5bc702305580cf12fde90ed7e19ea2ca137da7f9/INTEGRATION.md?plain=1#L155
---

## Context

Article Studio started with its own email and password accounts.

## Decision

Sign-in is NextAuth with Google, limited to designally.co, in every environment. There are no passwords. Every sign-in is an admin; the role column stays for the day non-admin accounts return.

## Why

