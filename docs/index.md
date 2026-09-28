---
layout: home

hero:
  name: EcoManage
  text: Energy management for real buildings
  tagline: Solar, batteries, EV chargers and heat pumps on one live view, with bills from your tariff and changes that only happen when someone approves them.
  image:
    src: /flow.svg
    alt: Energy flowing between solar, battery, grid, EV chargers and a heat pump
  actions:
    - theme: brand
      text: Try the demo
      link: /guide/getting-started
    - theme: alt
      text: User guide
      link: /guide/
    - theme: alt
      text: Deploy
      link: /deploy/
    - theme: alt
      text: Develop
      link: /develop/

features:
  - icon: ⚡
    title: Live site
    details: Power moving between solar, battery, grid, EV chargers, the heat pump and the building, every 5 seconds, on a 3D model of the site (or a 2D diagram without WebGL).
    link: /guide/home
  - icon: 🧾
    title: Bills you can check
    details: Time-of-use and demand tariffs with versions, the month so far and where it's heading, savings from solar and the battery, PDF statements, and your utility's bill compared with the estimate.
    link: /guide/bills
  - icon: ✅
    title: Recommendations with approval
    details: Peak shaving, EV off-peak charging, heat-pump pre-conditioning and more, each with its checks and saving. Nothing reaches a device until someone approves it, and every result is measured.
    link: /guide/inbox
  - icon: 🔔
    title: Alerts that close themselves
    details: Silent devices, low solar, demand near the cap, failed commands. Emails with escalation, remote fixes from the device profile, and auto-resolve when the problem clears.
    link: /guide/inbox#alerts
  - icon: 🧊
    title: A model of your site
    details: Generated from the building's size or its OpenStreetMap outline, or your own glTF, OBJ, FBX or IFC file, converted in a sandbox. Place each device where it is.
    link: /guide/site-model
  - icon: 🔌
    title: A real gateway
    details: A Raspberry Pi agent for Modbus TCP/RTU and OCPP 1.6J chargers, with a 7-day offline buffer, safety limits on every command, and claiming by QR code.
    link: /deploy/gateway
  - icon: 💬
    title: Explanations in plain words
    details: Bring any OpenAI-compatible key (or Anthropic) and get each recommendation explained. Only the numbers are sent; names and anything people typed stay on the server.
    link: /guide/explanations
  - icon: 🧪
    title: Try it without hardware
    details: A simulated school with weather, school-day loads, EV sessions and faults, and seeded demo accounts, all in Docker on your computer.
    link: /guide/getting-started
---

## Find your way

| If you… | Start with |
| ------- | ---------- |
| use EcoManage to run a site | the [User guide](/guide/): every page, roles, decisions and alerts |
| install or host it | [Deploy](/deploy/): servers, configuration, gateways, security and upkeep |
| change the code | [Develop](/develop/): setup, architecture, how each service works, testing |
| integrate with it | the [Reference](/reference/api): the REST API, MQTT, the database and device profiles |
