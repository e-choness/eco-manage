# EcoManage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

EcoManage is a full-stack web application designed to help users monitor, analyze, and optimize their resource consumption. It provides a comprehensive dashboard for tracking key metrics related to energy, finance, and environmental impact, enabling informed decision-making for better sustainability and cost-efficiency.

The application features a secure backend API built with Node.js and a responsive, modern frontend built with React and TypeScript.

![eco-manage-landing](./readme-img/ecomanage-landing.gif)

## Dashboard Showcase

A quick look at the main features of the EcoManage dashboard.

| Overview | Monitoring | Analytics | Optimization | Financial |
| :---: | :---: | :---: | :---: | :---: |
| <img src="./readme-img/ecomanage-overview.png" alt="Overview" width="200"> | <img src="./readme-img/ecomanage-realtime-monitoring.png" alt="Monitoring" width="200"> | <img src="./readme-img/ecomanage-energy-analytics.png" alt="Analytics" width="200"> | <img src="./readme-img/ecomanage-energy-optimization.png" alt="Optimization" width="200"> | <img src="./readme-img/ecomanage-financial-overview.png" alt="Financial" width="200"> |

## Features

- **Secure User Authentication**: Safe and secure registration and login system.
- **Interactive Dashboard**: A central hub to visualize key metrics and system status at a glance.
- **Resource Monitoring**: Track real-time data on resource usage.
- **In-depth Analytics**: Visualize historical data and trends with interactive charts and graphs.
- **Optimization Suggestions**: Receive actionable insights to improve efficiency and reduce costs.
- **Customizable Alerts**: Set up and receive notifications for important events or when metrics cross a certain threshold.
- **Financial Tracking**: Monitor costs and financial performance related to resource management.
- **User & System Settings**: Easily configure your account and application preferences.
- **Light & Dark Theme**: Switch between light and dark theme with ease.

## Tech Stack

### Frontend

- **Framework**: [React](https://reactjs.org/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **UI Components**: [Shadcn/UI](https://ui.shadcn.com/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Routing**: [React Router](https://reactrouter.com/)
- **State Management**: React Context API

### Backend

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Authentication**: JSON Web Tokens (JWT) for stateless authentication.
- **Security**: `bcrypt` for secure password hashing.
- **Database**: (Not specified, but compatible with any modern database like PostgreSQL, MongoDB, etc.)

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

- Node.js (v18.x or later recommended)
- npm or yarn

### Installation & Setup

1. **Clone the repository:**

    ```sh
    git clone <your-repository-url>
    cd EcoManage
    ```

2. **Install server dependencies:**

    ```sh
    cd server
    npm install
    ```

3. **Install client dependencies:**

    ```sh
    cd ../client
    npm install
    ```

### Configuration

The server requires environment variables to run correctly.

1. Navigate to the `server` directory.
2. Create a new file named `.env`.
3. Add the necessary environment variables. At a minimum, you will need:

    ```env
    # Port for the backend server
    PORT=5000

    # A secret key for signing JWTs
    JWT_SECRET=your_super_secret_and_long_key

    # Connection string for your database, remember to add your MongDB key to `.env` file using the following format.
    DATABASE_URL="postgresql://user:password@host:port/database"
    ```

### Running the Application

You will need to run the backend and frontend servers in separate terminals.

1. **Run the backend server:**

    ```sh
    cd server
    npm run dev
    ```

    The server will start on the port specified in your `.env` file (e.g., `http://localhost:5000`).

2. **Run the frontend client:**

    ```sh
    cd client
    npm run dev
    ```

    The React development server will start, typically at `http://localhost:3000`.

## License

This project is licensed under the MIT License - see the LICENSE.md file for details.
