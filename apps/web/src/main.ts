import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { createServices } from './app/services';

mount(App, { target: document.getElementById('app')!, props: { services: createServices() } });
