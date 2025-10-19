const { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Pool } = require('pg');
const cron = require('node-cron');

// Servidor web para mantener el bot activo 24/7
require('./server.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: parseInt(process.env.PG_MAX_CONNECTIONS || '8', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const REQUIRED_ROLES = [
    { name: '⚠️ WARN 1', color: 0xFEE75C },
    { name: '⚠️ WARN 2', color: 0xFF5722 },
    { name: '⚠️ WARN 3', color: 0xED4245 },
    { name: '🔒 DETENIDO', color: 0x747F8D },
    { name: '❌ NO VERIFICADO', color: 0x99AAB5 },
    { name: '✅ VERIFICADO', color: 0x57F287 },
    { name: '👮 SEGURIDAD PÚBLICA', color: 0x5865F2 }
];

const commands = [
    new SlashCommandBuilder()
        .setName('abrir')
        .setDescription('Anuncia la apertura del servidor')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('cerrar')
        .setDescription('Anuncia el cierre del servidor')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Asigna una advertencia progresiva a un usuario')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario a advertir')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('detener')
        .setDescription('Detiene a un usuario temporalmente')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario a detener')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('minutos')
                .setDescription('Tiempo de detención en minutos')
                .setRequired(true)
                .setMinValue(1)),

    new SlashCommandBuilder()
        .setName('verificar')
        .setDescription('Verifica tu cuenta de Roblox')
        .addStringOption(option =>
            option.setName('usuario_roblox')
                .setDescription('Tu nombre de usuario de Roblox')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('roltemp')
        .setDescription('Asigna un rol temporal a un usuario')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario que recibirá el rol')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('rol')
                .setDescription('Rol a asignar')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('minutos')
                .setDescription('Duración del rol en minutos')
                .setRequired(true)
                .setMinValue(1)),

    new SlashCommandBuilder()
        .setName('ayuda')
        .setDescription('Muestra la lista de comandos disponibles'),

    new SlashCommandBuilder()
        .setName('info')
        .setDescription('Muestra información detallada de un usuario verificado')
        .addUserOption(option =>
            option.setName('usuario')
                .setDescription('Usuario del que quieres ver información')
                .setRequired(true))
].map(command => command.toJSON());

async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Registrando slash commands...');

        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );

        console.log('✅ Slash commands registrados exitosamente');
    } catch (error) {
        console.error('❌ Error al registrar slash commands:', error);
    }
}

async function createRolesIfNeeded(guild) {
    console.log(`Verificando roles en el servidor: ${guild.name}`);

    for (const roleData of REQUIRED_ROLES) {
        const existingRole = guild.roles.cache.find(role => role.name.toqALowerCase() === roleData.name.toLowerCase());

        if (!existingRole) {
            try {
                await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    reason: 'Rol requerido para el sistema de roleplay'
                });
                console.log(`✅ Rol "${roleData.name}" creado exitosamente`);
            } catch (error) {
                console.error(`❌ Error al crear rol "${roleData.name}":`, error);
            }
        } else {
            console.log(`ℹ️ Rol "${roleData.name}" ya existe`);
        }
    }
}

async function assignNoVerificadoToExistingMembers(guild) {
    console.log(`Asignando rol "❌ NO VERIFICADO" a miembros existentes en: ${guild.name}`);

    const noVerificadoRole = guild.roles.cache.find(role => role.name.toLowerCase().includes('no verificado'));
    const verificadoRole = guild.roles.cache.find(role => role.name.toLowerCase().includes('verificado') && !role.name.toLowerCase().includes('no'));

    if (!noVerificadoRole) {
        console.log(`⚠️ Rol "❌ NO VERIFICADO" no encontrado en ${guild.name}`);
        return;
    }

    try {
        await guild.members.fetch();

        let assignedCount = 0;
        let skippedCount = 0;

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;

            if (verificadoRole && member.roles.cache.has(verificadoRole.id)) {
                skippedCount++;
                continue;
            }

            if (!member.roles.cache.has(noVerificadoRole.id)) {
                try {
                    await member.roles.add(noVerificadoRole);
                    assignedCount++;
                } catch (error) {
                    console.error(`Error al asignar rol a ${member.user.tag}:`, error);
                }
            }
        }

        console.log(`✅ Rol "❌ NO VERIFICADO" asignado a ${assignedCount} miembros (${skippedCount} ya verificados)`);

    } catch (error) {
        console.error(`Error al asignar roles en ${guild.name}:`, error);
    }
}

client.once('ready', async () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);

    await registerCommands();

    for (const guild of client.guilds.cache.values()) {
        await createRolesIfNeeded(guild);
        await assignNoVerificadoToExistingMembers(guild);
    }

    startTemporaryRoleChecker();
});

client.on('guildCreate', async (guild) => {
    console.log(`Bot añadido a un nuevo servidor: ${guild.name}`);
    await createRolesIfNeeded(guild);
});

client.on('guildMemberAdd', async (member) => {
    const noVerificadoRole = member.guild.roles.cache.find(role => role.name.toLowerCase().includes('no verificado'));

    if (noVerificadoRole) {
        try {
            await member.roles.add(noVerificadoRole);
            console.log(`✅ Rol "❌ NO VERIFICADO" asignado a ${member.user.tag}`);
        } catch (error) {
            console.error(`❌ Error al asignar rol "❌ NO VERIFICADO":`, error);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'abrir') {
            await handleAbrirServidor(interaction);
        } else if (commandName === 'cerrar') {
            await handleCerrarServidor(interaction);
        } else if (commandName === 'warn') {
            await handleWarn(interaction);
        } else if (commandName === 'detener') {
            await handleDetener(interaction);
        } else if (commandName === 'verificar') {
            await handleVerificar(interaction);
        } else if (commandName === 'roltemp') {
            await handleRolTemporal(interaction);
        } else if (commandName === 'ayuda') {
            await handleAyuda(interaction);
        } else if (commandName === 'info') {
            await handleInfo(interaction);
        }
    } catch (error) {
        console.error(`Error ejecutando comando ${commandName}:`, error);

        const errorMessage = '❌ Hubo un error al ejecutar este comando.';

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

async function handleAbrirServidor(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('🔓 SERVIDOR ABIERTO')
        .setDescription(
            '🇲🇽 México TBSRP vuelve a estar disponible para todos los ciudadanos. Prepárense para otra jornada llena de buen roleo, acción y momentos únicos dentro de la ciudad.\n\n' +
            '👮‍♂️ Los oficiales ya están patrullando, las facciones en movimiento y los civiles retomando sus historias. Mantén siempre el rol serio, respeta las normas y disfruta del ambiente realista que nos caracteriza.\n\n' +
            '🔥 Reúne a tu equipo, crea nuevas historias y demuestra quién manda en las calles.\n' +
            '🎭 El rol ya está activo, bienvenido nuevamente a México TBSRP.\nCODIGO:MEpWg'
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleCerrarServidor(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🔒 SERVIDOR CERRADO')
        .setDescription(
            '🇮🇽 México TBSRP ha finalizado sus actividades por ahora. Agradecemos a todos los que participaron en el rol y ayudaron a mantener la ciudad activa.\n\n' +
            '🛑 Es momento de descansar, revisar clips, reportes o simplemente relajarse hasta la próxima apertura.\n' +
            '👮‍♂️ Las facciones quedan en pausa y los civiles deberán esperar el próximo anuncio para volver a rolear.\n\n' +
            '💤 Mantente atento a los avisos del staff y al canal de estado del servidor.\n' +
            '🔥 Nos vemos pronto en la próxima apertura de México TBSRP.'
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleWarn(interaction) {
    const targetUser = interaction.options.getMember('usuario');

    if (!targetUser) {
        return interaction.reply({ content: '❌ Usuario no encontrado.', ephemeral: true });
    }

    try {
        const result = await pool.query(
            'SELECT warn_count FROM user_warns WHERE discord_user_id = $1',
            [targetUser.id]
        );

        let warnCount = 0;
        if (result.rows.length > 0) {
            warnCount = result.rows[0].warn_count;
        }

        warnCount++;

        await pool.query(
            'INSERT INTO user_warns (discord_user_id, warn_count, last_warn_at) VALUES ($1, $2, NOW()) ON CONFLICT (discord_user_id) DO UPDATE SET warn_count = $2, last_warn_at = NOW()',
            [targetUser.id, warnCount]
        );

        const warn1Role = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('warn 1'));
        const warn2Role = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('warn 2'));
        const warn3Role = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('warn 3'));

        await targetUser.roles.remove([warn1Role, warn2Role, warn3Role].filter(r => r));

        if (warnCount === 1 && warn1Role) {
            await targetUser.roles.add(warn1Role);
            await interaction.reply(`⚠️ ${targetUser.user.tag} ha recibido su primera advertencia (⚠️ WARN 1)`);
        } else if (warnCount === 2 && warn2Role) {
            await targetUser.roles.add(warn2Role);
            await interaction.reply(`⚠️ ${targetUser.user.tag} ha recibido su segunda advertencia (⚠️ WARN 2)`);
        } else if (warnCount >= 3 && warn3Role) {
            await targetUser.roles.add(warn3Role);
            await interaction.reply(`⚠️ ${targetUser.user.tag} ha recibido su tercera advertencia (⚠️ WARN 3)`);
        }

    } catch (error) {
        console.error('Error al procesar warn:', error);
        await interaction.reply({ content: '❌ Hubo un error al procesar la advertencia.', ephemeral: true });
    }
}

async function handleDetener(interaction) {
    const seguridadRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('seguridad'));

    if (!seguridadRole || !interaction.member.roles.cache.has(seguridadRole.id)) {
        return interaction.reply({ content: '❌ Solo miembros de 👮 SEGURIDAD PÚBLICA pueden usar este comando.', ephemeral: true });
    }

    const targetUser = interaction.options.getMember('usuario');
    const minutes = interaction.options.getInteger('minutos');

    if (!targetUser) {
        return interaction.reply({ content: '❌ Usuario no encontrado.', ephemeral: true });
    }

    const detenidoRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('detenido'));

    if (!detenidoRole) {
        return interaction.reply({ content: '❌ El rol "🔒 DETENIDO" no existe en este servidor.', ephemeral: true });
    }

    try {
        await targetUser.roles.add(detenidoRole);

        const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

        await pool.query(
            'DELETE FROM temporary_roles WHERE discord_user_id = $1 AND role_id = $2',
            [targetUser.id, detenidoRole.id]
        );

        await pool.query(
            'INSERT INTO temporary_roles (discord_user_id, role_id, expires_at) VALUES ($1, $2, $3)',
            [targetUser.id, detenidoRole.id, expiresAt]
        );

        await interaction.reply(`🚔 ${targetUser.user.tag} ha sido detenido por ${minutes} minuto(s).`);

    } catch (error) {
        console.error('Error al detener usuario:', error);
        await interaction.reply({ content: '❌ Hubo un error al procesar la detención.', ephemeral: true });
    }
}

async function handleVerificar(interaction) {
    const robloxUsername = interaction.options.getString('usuario_roblox');

    // Validación de input
    if (!robloxUsername || robloxUsername.length < 3 || robloxUsername.length > 20) {
        return interaction.reply({ 
            content: '❌ El nombre de usuario de Roblox debe tener entre 3 y 20 caracteres.', 
            ephemeral: true 
        });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(robloxUsername)) {
        return interaction.reply({ 
            content: '❌ El nombre de usuario de Roblox solo puede contener letras, números y guiones bajos.', 
            ephemeral: true 
        });
    }

    try {
        const existingCheck = await pool.query(
            'SELECT discord_user_id FROM roblox_verifications WHERE roblox_username = $1',
            [robloxUsername.toLowerCase()]
        );

        if (existingCheck.rows.length > 0) {
            return interaction.reply({ content: `❌ El usuario de Roblox "${robloxUsername}" ya está registrado en este servidor.`, ephemeral: true });
        }

        const response = await fetch(`https://users.roblox.com/v1/usernames/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [robloxUsername] })
        });

        const data = await response.json();

        if (!data.data || data.data.length === 0) {
            return interaction.reply({ content: `❌ El usuario "${robloxUsername}" no existe en Roblox.`, ephemeral: true });
        }

        const robloxUser = data.data[0];

        await pool.query(
            'INSERT INTO roblox_verifications (discord_user_id, roblox_username) VALUES ($1, $2)',
            [interaction.user.id, robloxUser.name.toLowerCase()]
        );

        const noVerificadoRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('no verificado'));
        const verificadoRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase().includes('verificado') && !r.name.toLowerCase().includes('no'));

        if (noVerificadoRole) {
            await interaction.member.roles.remove(noVerificadoRole);
        }
        if (verificadoRole) {
            await interaction.member.roles.add(verificadoRole);
        }

        await interaction.member.setNickname(robloxUser.name).catch(() => {});

        await interaction.reply(`✅ ¡Verificación exitosa! Tu usuario de Roblox "${robloxUser.name}" ha sido vinculado.`);

    } catch (error) {
        console.error('Error al verificar usuario:', error);
        await interaction.reply({ content: '❌ Hubo un error al verificar tu usuario de Roblox.', ephemeral: true });
    }
}

async function handleRolTemporal(interaction) {
    const targetUser = interaction.options.getMember('usuario');
    const role = interaction.options.getRole('rol');
    const minutes = interaction.options.getInteger('minutos');

    if (!targetUser) {
        return interaction.reply({ content: '❌ Usuario no encontrado.', ephemeral: true });
    }

    try {
        await targetUser.roles.add(role);

        const expiresAt = new Date(Date.now() + minutes * 60 * 1000);

        await pool.query(
            'DELETE FROM temporary_roles WHERE discord_user_id = $1 AND role_id = $2',
            [targetUser.id, role.id]
        );

        await pool.query(
            'INSERT INTO temporary_roles (discord_user_id, role_id, expires_at) VALUES ($1, $2, $3)',
            [targetUser.id, role.id, expiresAt]
        );

        await interaction.reply(`✅ Rol "${role.name}" asignado a ${targetUser.user.tag} por ${minutes} minuto(s).`);

    } catch (error) {
        console.error('Error al asignar rol temporal:', error);
        await interaction.reply({ content: '❌ Hubo un error al asignar el rol temporal.', ephemeral: true });
    }
}

async function handleInfo(interaction) {
    const targetUser = interaction.options.getMember('usuario');

    if (!targetUser) {
        return interaction.reply({ content: '❌ Usuario no encontrado en el servidor.', ephemeral: true });
    }

    try {
        const result = await pool.query(
            'SELECT roblox_username FROM roblox_verifications WHERE discord_user_id = $1',
            [targetUser.id]
        );

        if (result.rows.length === 0) {
            return interaction.reply({ content: '❌ Este usuario no está verificado con Roblox.', ephemeral: true });
        }

        const robloxUsername = result.rows[0].roblox_username;

        const robloxResponse = await fetch(`https://users.roblox.com/v1/usernames/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [robloxUsername] })
        });

        const robloxData = await robloxResponse.json();
        
        if (!robloxData.data || robloxData.data.length === 0) {
            return interaction.reply({ content: '❌ No se pudo obtener información de Roblox.', ephemeral: true });
        }

        const robloxUserId = robloxData.data[0].id;

        const robloxInfoResponse = await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`);
        const robloxInfo = await robloxInfoResponse.json();

        const robloxCreatedDate = new Date(robloxInfo.created);
        const discordCreatedDate = targetUser.user.createdAt;
        const joinedServerDate = targetUser.joinedAt;

        const embed = new EmbedBuilder()
            .setColor(0x00D9FF)
            .setTitle('📊 Información de Usuario')
            .setThumbnail(targetUser.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: '👤 Usuario de Discord', value: `${targetUser.user.tag}`, inline: true },
                { name: '🎮 Usuario de Roblox', value: `${robloxInfo.name}`, inline: true },
                { name: '\u200B', value: '\u200B', inline: false },
                { name: '📅 Cuenta de Roblox creada', value: `<t:${Math.floor(robloxCreatedDate.getTime() / 1000)}:D>`, inline: true },
                { name: '📅 Cuenta de Discord creada', value: `<t:${Math.floor(discordCreatedDate.getTime() / 1000)}:D>`, inline: true },
                { name: '📅 Se unió al servidor', value: `<t:${Math.floor(joinedServerDate.getTime() / 1000)}:D>`, inline: true }
            )
            .setFooter({ text: `ID de Discord: ${targetUser.id} | ID de Roblox: ${robloxUserId}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

    } catch (error) {
        console.error('Error al obtener información del usuario:', error);
        await interaction.reply({ content: '❌ Hubo un error al obtener la información del usuario.', ephemeral: true });
    }
}

async function handleAyuda(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📋 Comandos del Bot - México TBSRP')
        .addFields(
            { name: '🔓 /abrir', value: 'Anuncia la apertura del servidor (Solo administradores)' },
            { name: '🔒 /cerrar', value: 'Anuncia el cierre del servidor (Solo administradores)' },
            { name: '⚠️ /warn', value: 'Asigna un warn progresivo al usuario (Solo moderadores)' },
            { name: '🚔 /detener', value: 'Detiene al usuario por el tiempo especificado (Solo 👮 SEGURIDAD PÚBLICA)' },
            { name: '✅ /verificar', value: 'Verifica tu cuenta de Roblox (Todos los usuarios)' },
            { name: '📊 /info', value: 'Muestra información detallada de un usuario verificado (Todos los usuarios)' },
            { name: '⏰ /roltemp', value: 'Asigna un rol temporal (Solo administradores)' },
            { name: '❓ /ayuda', value: 'Muestra este mensaje de ayuda' }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

function startTemporaryRoleChecker() {
    cron.schedule('* * * * *', async () => {
        try {
            const result = await pool.query(
                'SELECT * FROM temporary_roles WHERE expires_at <= NOW()'
            );

            for (const row of result.rows) {
                for (const guild of client.guilds.cache.values()) {
                    const member = await guild.members.fetch(row.discord_user_id).catch(() => null);
                    const role = guild.roles.cache.get(row.role_id);

                    if (member && role) {
                        await member.roles.remove(role).catch(() => {});
                        console.log(`✅ Rol temporal "${role.name}" removido de ${member.user.tag}`);
                    }
                }

                await pool.query('DELETE FROM temporary_roles WHERE id = $1', [row.id]);
            }
        } catch (error) {
            console.error('Error al verificar roles temporales:', error);
        }
    });
}

// Manejo de errores globales
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});

// Graceful shutdown
async function shutdown(signal) {
    console.log(`\n${signal} received: shutting down gracefully...`);
    try {
        await client.destroy();
        console.log('✅ Discord client closed');
    } catch (err) {
        console.error('Error closing Discord client:', err);
    }
    
    try {
        await pool.end();
        console.log('✅ PostgreSQL pool closed');
    } catch (err) {
        console.error('Error closing PostgreSQL pool:', err);
    }
    
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (!process.env.DISCORD_TOKEN) {
    console.error('❌ ERROR: No se encontró DISCORD_TOKEN en las variables de entorno.');
    console.log('Por favor, configura tu token de Discord en los secretos de Replit.');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
