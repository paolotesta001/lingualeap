"""Build lessons.json with 10 progressive levels per language."""
import json
import os

# Each language has the same structure but with translated content.
# Levels go from 1 (absolute beginner) to 10 (advanced).

# Common lesson topics by level (used for all languages)
LEVEL_TOPICS = [
    {"id": 1, "name": "First Words", "icon": "👋", "desc": "Greetings and basic words"},
    {"id": 2, "name": "Numbers & Colors", "icon": "🔢", "desc": "Counting and naming colors"},
    {"id": 3, "name": "Family & People", "icon": "👨‍👩‍👧", "desc": "Talking about family"},
    {"id": 4, "name": "Food & Drinks", "icon": "🍽️", "desc": "Ordering and describing food"},
    {"id": 5, "name": "Daily Routine", "icon": "⏰", "desc": "Describing your day"},
    {"id": 6, "name": "Travel & Places", "icon": "✈️", "desc": "Asking directions, hotels"},
    {"id": 7, "name": "Past & Future", "icon": "📅", "desc": "Tenses beyond the present"},
    {"id": 8, "name": "Opinions & Feelings", "icon": "💭", "desc": "Expressing yourself"},
    {"id": 9, "name": "Complex Conversations", "icon": "💬", "desc": "Real-life dialogues"},
    {"id": 10, "name": "Advanced Mastery", "icon": "🎓", "desc": "Idioms and nuances"},
]

# Content per language: vocabulary and phrases for each level
LANGUAGE_CONTENT = {
    "es": {
        1: {
            "vocab": [
                ("hola", "hello"), ("adiós", "goodbye"), ("sí", "yes"), ("no", "no"),
                ("por favor", "please"), ("gracias", "thank you"), ("perdón", "sorry"),
                ("buenos días", "good morning"), ("buenas noches", "good night"),
                ("yo", "I"), ("tú", "you"), ("él", "he"), ("ella", "she"),
            ],
            "phrases": [
                ("¿Cómo te llamas?", "What's your name?"),
                ("Me llamo Ana.", "My name is Ana."),
                ("Mucho gusto.", "Nice to meet you."),
                ("¿Cómo estás?", "How are you?"),
                ("Estoy bien, gracias.", "I'm well, thank you."),
            ],
        },
        2: {
            "vocab": [
                ("uno", "one"), ("dos", "two"), ("tres", "three"), ("cuatro", "four"),
                ("cinco", "five"), ("seis", "six"), ("siete", "seven"), ("ocho", "eight"),
                ("nueve", "nine"), ("diez", "ten"),
                ("rojo", "red"), ("azul", "blue"), ("verde", "green"), ("amarillo", "yellow"),
                ("blanco", "white"), ("negro", "black"),
            ],
            "phrases": [
                ("Tengo cinco años.", "I am five years old."),
                ("El cielo es azul.", "The sky is blue."),
                ("Mi color favorito es el verde.", "My favorite color is green."),
                ("Hay tres manzanas.", "There are three apples."),
            ],
        },
        3: {
            "vocab": [
                ("madre", "mother"), ("padre", "father"), ("hermano", "brother"),
                ("hermana", "sister"), ("hijo", "son"), ("hija", "daughter"),
                ("abuelo", "grandfather"), ("abuela", "grandmother"),
                ("amigo", "friend"), ("familia", "family"),
            ],
            "phrases": [
                ("Tengo dos hermanos.", "I have two brothers."),
                ("Mi madre es profesora.", "My mother is a teacher."),
                ("Vivo con mi familia.", "I live with my family."),
                ("Mi mejor amigo se llama Juan.", "My best friend's name is Juan."),
            ],
        },
        4: {
            "vocab": [
                ("agua", "water"), ("pan", "bread"), ("café", "coffee"), ("té", "tea"),
                ("leche", "milk"), ("vino", "wine"), ("cerveza", "beer"),
                ("manzana", "apple"), ("queso", "cheese"), ("carne", "meat"),
                ("pescado", "fish"), ("arroz", "rice"),
            ],
            "phrases": [
                ("Quiero un café, por favor.", "I want a coffee, please."),
                ("¿Tiene menú en inglés?", "Do you have a menu in English?"),
                ("La cuenta, por favor.", "The bill, please."),
                ("Soy vegetariano.", "I am vegetarian."),
            ],
        },
        5: {
            "vocab": [
                ("despertarse", "to wake up"), ("desayunar", "to have breakfast"),
                ("ducharse", "to shower"), ("trabajar", "to work"), ("comer", "to eat"),
                ("dormir", "to sleep"), ("estudiar", "to study"), ("leer", "to read"),
                ("mañana", "morning"), ("tarde", "afternoon"), ("noche", "night"),
            ],
            "phrases": [
                ("Me despierto a las siete.", "I wake up at seven."),
                ("Trabajo de nueve a cinco.", "I work from nine to five."),
                ("Por la tarde estudio español.", "In the afternoon I study Spanish."),
                ("Me acuesto a las once.", "I go to bed at eleven."),
            ],
        },
        6: {
            "vocab": [
                ("aeropuerto", "airport"), ("hotel", "hotel"), ("estación", "station"),
                ("calle", "street"), ("mapa", "map"), ("derecha", "right"),
                ("izquierda", "left"), ("cerca", "near"), ("lejos", "far"),
                ("habitación", "room"),
            ],
            "phrases": [
                ("¿Dónde está la estación?", "Where is the station?"),
                ("Gire a la derecha.", "Turn right."),
                ("Quisiera reservar una habitación.", "I would like to book a room."),
                ("¿Cuánto cuesta?", "How much does it cost?"),
            ],
        },
        7: {
            "vocab": [
                ("ayer", "yesterday"), ("hoy", "today"), ("mañana", "tomorrow"),
                ("la semana pasada", "last week"), ("el año próximo", "next year"),
                ("fui", "I went"), ("comí", "I ate"), ("hice", "I did"),
                ("iré", "I will go"), ("haré", "I will do"),
            ],
            "phrases": [
                ("Ayer fui al cine.", "Yesterday I went to the cinema."),
                ("Mañana viajaré a Madrid.", "Tomorrow I will travel to Madrid."),
                ("La semana pasada vi a María.", "Last week I saw María."),
                ("El año próximo aprenderé francés.", "Next year I will learn French."),
            ],
        },
        8: {
            "vocab": [
                ("creo que", "I think that"), ("me gusta", "I like"),
                ("no me gusta", "I don't like"), ("prefiero", "I prefer"),
                ("estoy de acuerdo", "I agree"), ("feliz", "happy"),
                ("triste", "sad"), ("enfadado", "angry"), ("cansado", "tired"),
                ("emocionado", "excited"),
            ],
            "phrases": [
                ("Creo que es una buena idea.", "I think it's a good idea."),
                ("Me gusta mucho la música.", "I really like music."),
                ("Estoy un poco cansado hoy.", "I'm a bit tired today."),
                ("¿Qué piensas tú?", "What do you think?"),
            ],
        },
        9: {
            "vocab": [
                ("aunque", "although"), ("sin embargo", "however"),
                ("por lo tanto", "therefore"), ("además", "moreover"),
                ("a pesar de", "despite"), ("mientras", "while"),
                ("en cuanto a", "regarding"), ("de hecho", "in fact"),
            ],
            "phrases": [
                ("Aunque llueve, voy a salir.", "Although it's raining, I'll go out."),
                ("Me gustaría hablar con el gerente.", "I'd like to speak with the manager."),
                ("¿Podría repetir, por favor?", "Could you repeat, please?"),
                ("No estoy seguro, déjame pensar.", "I'm not sure, let me think."),
            ],
        },
        10: {
            "vocab": [
                ("estar en las nubes", "to be daydreaming"),
                ("tomar el pelo", "to pull someone's leg"),
                ("hablar por los codos", "to talk a lot"),
                ("costar un ojo de la cara", "to cost an arm and a leg"),
                ("ser pan comido", "to be a piece of cake"),
                ("dar en el clavo", "to hit the nail on the head"),
            ],
            "phrases": [
                ("¡No me tomes el pelo!", "Don't pull my leg!"),
                ("Ese examen fue pan comido.", "That exam was a piece of cake."),
                ("Mi hermana habla por los codos.", "My sister talks a lot."),
                ("Has dado en el clavo.", "You've hit the nail on the head."),
            ],
        },
    },
    "it": {
        1: {
            "vocab": [
                ("ciao", "hello/bye"), ("arrivederci", "goodbye"), ("sì", "yes"), ("no", "no"),
                ("per favore", "please"), ("grazie", "thank you"), ("scusa", "sorry"),
                ("buongiorno", "good morning"), ("buonanotte", "good night"),
                ("io", "I"), ("tu", "you"), ("lui", "he"), ("lei", "she"),
            ],
            "phrases": [
                ("Come ti chiami?", "What's your name?"),
                ("Mi chiamo Anna.", "My name is Anna."),
                ("Piacere di conoscerti.", "Nice to meet you."),
                ("Come stai?", "How are you?"),
                ("Sto bene, grazie.", "I'm well, thank you."),
            ],
        },
        2: {
            "vocab": [
                ("uno", "one"), ("due", "two"), ("tre", "three"), ("quattro", "four"),
                ("cinque", "five"), ("sei", "six"), ("sette", "seven"), ("otto", "eight"),
                ("nove", "nine"), ("dieci", "ten"),
                ("rosso", "red"), ("blu", "blue"), ("verde", "green"), ("giallo", "yellow"),
                ("bianco", "white"), ("nero", "black"),
            ],
            "phrases": [
                ("Ho cinque anni.", "I am five years old."),
                ("Il cielo è blu.", "The sky is blue."),
                ("Il mio colore preferito è il verde.", "My favorite color is green."),
                ("Ci sono tre mele.", "There are three apples."),
            ],
        },
        3: {
            "vocab": [
                ("madre", "mother"), ("padre", "father"), ("fratello", "brother"),
                ("sorella", "sister"), ("figlio", "son"), ("figlia", "daughter"),
                ("nonno", "grandfather"), ("nonna", "grandmother"),
                ("amico", "friend"), ("famiglia", "family"),
            ],
            "phrases": [
                ("Ho due fratelli.", "I have two brothers."),
                ("Mia madre è insegnante.", "My mother is a teacher."),
                ("Vivo con la mia famiglia.", "I live with my family."),
                ("Il mio migliore amico si chiama Marco.", "My best friend's name is Marco."),
            ],
        },
        4: {
            "vocab": [
                ("acqua", "water"), ("pane", "bread"), ("caffè", "coffee"), ("tè", "tea"),
                ("latte", "milk"), ("vino", "wine"), ("birra", "beer"),
                ("mela", "apple"), ("formaggio", "cheese"), ("carne", "meat"),
                ("pesce", "fish"), ("riso", "rice"),
            ],
            "phrases": [
                ("Vorrei un caffè, per favore.", "I'd like a coffee, please."),
                ("Avete un menù in inglese?", "Do you have a menu in English?"),
                ("Il conto, per favore.", "The bill, please."),
                ("Sono vegetariano.", "I am vegetarian."),
            ],
        },
        5: {
            "vocab": [
                ("svegliarsi", "to wake up"), ("fare colazione", "to have breakfast"),
                ("farsi la doccia", "to shower"), ("lavorare", "to work"),
                ("mangiare", "to eat"), ("dormire", "to sleep"), ("studiare", "to study"),
                ("leggere", "to read"),
                ("mattina", "morning"), ("pomeriggio", "afternoon"), ("sera", "evening"),
            ],
            "phrases": [
                ("Mi sveglio alle sette.", "I wake up at seven."),
                ("Lavoro dalle nove alle cinque.", "I work from nine to five."),
                ("Il pomeriggio studio italiano.", "In the afternoon I study Italian."),
                ("Vado a letto alle undici.", "I go to bed at eleven."),
            ],
        },
        6: {
            "vocab": [
                ("aeroporto", "airport"), ("hotel", "hotel"), ("stazione", "station"),
                ("strada", "street"), ("mappa", "map"), ("destra", "right"),
                ("sinistra", "left"), ("vicino", "near"), ("lontano", "far"),
                ("camera", "room"),
            ],
            "phrases": [
                ("Dov'è la stazione?", "Where is the station?"),
                ("Giri a destra.", "Turn right."),
                ("Vorrei prenotare una camera.", "I would like to book a room."),
                ("Quanto costa?", "How much does it cost?"),
            ],
        },
        7: {
            "vocab": [
                ("ieri", "yesterday"), ("oggi", "today"), ("domani", "tomorrow"),
                ("la settimana scorsa", "last week"), ("l'anno prossimo", "next year"),
                ("sono andato", "I went"), ("ho mangiato", "I ate"), ("ho fatto", "I did"),
                ("andrò", "I will go"), ("farò", "I will do"),
            ],
            "phrases": [
                ("Ieri sono andato al cinema.", "Yesterday I went to the cinema."),
                ("Domani viaggerò a Roma.", "Tomorrow I will travel to Rome."),
                ("La settimana scorsa ho visto Maria.", "Last week I saw Maria."),
                ("L'anno prossimo imparerò il francese.", "Next year I will learn French."),
            ],
        },
        8: {
            "vocab": [
                ("penso che", "I think that"), ("mi piace", "I like"),
                ("non mi piace", "I don't like"), ("preferisco", "I prefer"),
                ("sono d'accordo", "I agree"), ("felice", "happy"),
                ("triste", "sad"), ("arrabbiato", "angry"), ("stanco", "tired"),
                ("emozionato", "excited"),
            ],
            "phrases": [
                ("Penso che sia una buona idea.", "I think it's a good idea."),
                ("Mi piace molto la musica.", "I really like music."),
                ("Sono un po' stanco oggi.", "I'm a bit tired today."),
                ("Cosa ne pensi?", "What do you think?"),
            ],
        },
        9: {
            "vocab": [
                ("anche se", "although"), ("tuttavia", "however"),
                ("quindi", "therefore"), ("inoltre", "moreover"),
                ("nonostante", "despite"), ("mentre", "while"),
                ("riguardo a", "regarding"), ("infatti", "in fact"),
            ],
            "phrases": [
                ("Anche se piove, esco.", "Although it's raining, I'm going out."),
                ("Vorrei parlare con il direttore.", "I'd like to speak with the manager."),
                ("Potrebbe ripetere, per favore?", "Could you repeat, please?"),
                ("Non sono sicuro, fammi pensare.", "I'm not sure, let me think."),
            ],
        },
        10: {
            "vocab": [
                ("essere al settimo cielo", "to be on cloud nine"),
                ("prendere in giro", "to make fun of"),
                ("avere la testa fra le nuvole", "to have one's head in the clouds"),
                ("costare un occhio della testa", "to cost an arm and a leg"),
                ("essere un gioco da ragazzi", "to be a piece of cake"),
                ("rompere il ghiaccio", "to break the ice"),
            ],
            "phrases": [
                ("Non prendermi in giro!", "Don't make fun of me!"),
                ("Quell'esame è stato un gioco da ragazzi.", "That exam was a piece of cake."),
                ("Sono al settimo cielo!", "I'm on cloud nine!"),
                ("Cerchiamo di rompere il ghiaccio.", "Let's break the ice."),
            ],
        },
    },
    "fr": {
        1: {
            "vocab": [
                ("bonjour", "hello"), ("au revoir", "goodbye"), ("oui", "yes"), ("non", "no"),
                ("s'il vous plaît", "please"), ("merci", "thank you"), ("pardon", "sorry"),
                ("bonsoir", "good evening"), ("bonne nuit", "good night"),
                ("je", "I"), ("tu", "you"), ("il", "he"), ("elle", "she"),
            ],
            "phrases": [
                ("Comment t'appelles-tu?", "What's your name?"),
                ("Je m'appelle Marie.", "My name is Marie."),
                ("Enchanté.", "Nice to meet you."),
                ("Comment vas-tu?", "How are you?"),
                ("Je vais bien, merci.", "I'm well, thank you."),
            ],
        },
        2: {
            "vocab": [
                ("un", "one"), ("deux", "two"), ("trois", "three"), ("quatre", "four"),
                ("cinq", "five"), ("six", "six"), ("sept", "seven"), ("huit", "eight"),
                ("neuf", "nine"), ("dix", "ten"),
                ("rouge", "red"), ("bleu", "blue"), ("vert", "green"), ("jaune", "yellow"),
                ("blanc", "white"), ("noir", "black"),
            ],
            "phrases": [
                ("J'ai cinq ans.", "I am five years old."),
                ("Le ciel est bleu.", "The sky is blue."),
                ("Ma couleur préférée est le vert.", "My favorite color is green."),
                ("Il y a trois pommes.", "There are three apples."),
            ],
        },
        3: {
            "vocab": [
                ("mère", "mother"), ("père", "father"), ("frère", "brother"),
                ("sœur", "sister"), ("fils", "son"), ("fille", "daughter"),
                ("grand-père", "grandfather"), ("grand-mère", "grandmother"),
                ("ami", "friend"), ("famille", "family"),
            ],
            "phrases": [
                ("J'ai deux frères.", "I have two brothers."),
                ("Ma mère est professeure.", "My mother is a teacher."),
                ("Je vis avec ma famille.", "I live with my family."),
                ("Mon meilleur ami s'appelle Pierre.", "My best friend's name is Pierre."),
            ],
        },
        4: {
            "vocab": [
                ("eau", "water"), ("pain", "bread"), ("café", "coffee"), ("thé", "tea"),
                ("lait", "milk"), ("vin", "wine"), ("bière", "beer"),
                ("pomme", "apple"), ("fromage", "cheese"), ("viande", "meat"),
                ("poisson", "fish"), ("riz", "rice"),
            ],
            "phrases": [
                ("Je voudrais un café, s'il vous plaît.", "I'd like a coffee, please."),
                ("Avez-vous un menu en anglais?", "Do you have a menu in English?"),
                ("L'addition, s'il vous plaît.", "The bill, please."),
                ("Je suis végétarien.", "I am vegetarian."),
            ],
        },
        5: {
            "vocab": [
                ("se réveiller", "to wake up"), ("prendre le petit-déjeuner", "to have breakfast"),
                ("se doucher", "to shower"), ("travailler", "to work"),
                ("manger", "to eat"), ("dormir", "to sleep"), ("étudier", "to study"),
                ("lire", "to read"),
                ("matin", "morning"), ("après-midi", "afternoon"), ("soir", "evening"),
            ],
            "phrases": [
                ("Je me réveille à sept heures.", "I wake up at seven."),
                ("Je travaille de neuf à cinq.", "I work from nine to five."),
                ("L'après-midi j'étudie le français.", "In the afternoon I study French."),
                ("Je me couche à onze heures.", "I go to bed at eleven."),
            ],
        },
        6: {
            "vocab": [
                ("aéroport", "airport"), ("hôtel", "hotel"), ("gare", "station"),
                ("rue", "street"), ("carte", "map"), ("droite", "right"),
                ("gauche", "left"), ("près", "near"), ("loin", "far"),
                ("chambre", "room"),
            ],
            "phrases": [
                ("Où est la gare?", "Where is the station?"),
                ("Tournez à droite.", "Turn right."),
                ("Je voudrais réserver une chambre.", "I would like to book a room."),
                ("Combien ça coûte?", "How much does it cost?"),
            ],
        },
        7: {
            "vocab": [
                ("hier", "yesterday"), ("aujourd'hui", "today"), ("demain", "tomorrow"),
                ("la semaine dernière", "last week"), ("l'année prochaine", "next year"),
                ("je suis allé", "I went"), ("j'ai mangé", "I ate"), ("j'ai fait", "I did"),
                ("j'irai", "I will go"), ("je ferai", "I will do"),
            ],
            "phrases": [
                ("Hier je suis allé au cinéma.", "Yesterday I went to the cinema."),
                ("Demain je voyagerai à Paris.", "Tomorrow I will travel to Paris."),
                ("La semaine dernière j'ai vu Marie.", "Last week I saw Marie."),
                ("L'année prochaine j'apprendrai l'espagnol.", "Next year I will learn Spanish."),
            ],
        },
        8: {
            "vocab": [
                ("je pense que", "I think that"), ("j'aime", "I like"),
                ("je n'aime pas", "I don't like"), ("je préfère", "I prefer"),
                ("je suis d'accord", "I agree"), ("heureux", "happy"),
                ("triste", "sad"), ("en colère", "angry"), ("fatigué", "tired"),
                ("excité", "excited"),
            ],
            "phrases": [
                ("Je pense que c'est une bonne idée.", "I think it's a good idea."),
                ("J'aime beaucoup la musique.", "I really like music."),
                ("Je suis un peu fatigué aujourd'hui.", "I'm a bit tired today."),
                ("Qu'en penses-tu?", "What do you think?"),
            ],
        },
        9: {
            "vocab": [
                ("bien que", "although"), ("cependant", "however"),
                ("donc", "therefore"), ("de plus", "moreover"),
                ("malgré", "despite"), ("pendant que", "while"),
                ("concernant", "regarding"), ("en fait", "in fact"),
            ],
            "phrases": [
                ("Bien qu'il pleuve, je sors.", "Although it's raining, I'm going out."),
                ("Je voudrais parler au directeur.", "I'd like to speak with the manager."),
                ("Pourriez-vous répéter, s'il vous plaît?", "Could you repeat, please?"),
                ("Je ne suis pas sûr, laissez-moi réfléchir.", "I'm not sure, let me think."),
            ],
        },
        10: {
            "vocab": [
                ("être dans la lune", "to be daydreaming"),
                ("se faire avoir", "to be tricked"),
                ("avoir le coup de foudre", "love at first sight"),
                ("coûter les yeux de la tête", "to cost an arm and a leg"),
                ("c'est du gâteau", "it's a piece of cake"),
                ("briser la glace", "to break the ice"),
            ],
            "phrases": [
                ("Cet examen, c'était du gâteau.", "That exam was a piece of cake."),
                ("Tu es dans la lune!", "You're daydreaming!"),
                ("Cette voiture coûte les yeux de la tête.", "This car costs an arm and a leg."),
                ("Essayons de briser la glace.", "Let's try to break the ice."),
            ],
        },
    },
    "de": {
        1: {
            "vocab": [
                ("hallo", "hello"), ("tschüss", "bye"), ("ja", "yes"), ("nein", "no"),
                ("bitte", "please"), ("danke", "thank you"), ("entschuldigung", "sorry"),
                ("guten Morgen", "good morning"), ("gute Nacht", "good night"),
                ("ich", "I"), ("du", "you"), ("er", "he"), ("sie", "she"),
            ],
            "phrases": [
                ("Wie heißt du?", "What's your name?"),
                ("Ich heiße Anna.", "My name is Anna."),
                ("Freut mich.", "Nice to meet you."),
                ("Wie geht es dir?", "How are you?"),
                ("Mir geht es gut, danke.", "I'm well, thank you."),
            ],
        },
        2: {
            "vocab": [
                ("eins", "one"), ("zwei", "two"), ("drei", "three"), ("vier", "four"),
                ("fünf", "five"), ("sechs", "six"), ("sieben", "seven"), ("acht", "eight"),
                ("neun", "nine"), ("zehn", "ten"),
                ("rot", "red"), ("blau", "blue"), ("grün", "green"), ("gelb", "yellow"),
                ("weiß", "white"), ("schwarz", "black"),
            ],
            "phrases": [
                ("Ich bin fünf Jahre alt.", "I am five years old."),
                ("Der Himmel ist blau.", "The sky is blue."),
                ("Meine Lieblingsfarbe ist grün.", "My favorite color is green."),
                ("Es gibt drei Äpfel.", "There are three apples."),
            ],
        },
        3: {
            "vocab": [
                ("Mutter", "mother"), ("Vater", "father"), ("Bruder", "brother"),
                ("Schwester", "sister"), ("Sohn", "son"), ("Tochter", "daughter"),
                ("Großvater", "grandfather"), ("Großmutter", "grandmother"),
                ("Freund", "friend"), ("Familie", "family"),
            ],
            "phrases": [
                ("Ich habe zwei Brüder.", "I have two brothers."),
                ("Meine Mutter ist Lehrerin.", "My mother is a teacher."),
                ("Ich wohne mit meiner Familie.", "I live with my family."),
                ("Mein bester Freund heißt Thomas.", "My best friend's name is Thomas."),
            ],
        },
        4: {
            "vocab": [
                ("Wasser", "water"), ("Brot", "bread"), ("Kaffee", "coffee"), ("Tee", "tea"),
                ("Milch", "milk"), ("Wein", "wine"), ("Bier", "beer"),
                ("Apfel", "apple"), ("Käse", "cheese"), ("Fleisch", "meat"),
                ("Fisch", "fish"), ("Reis", "rice"),
            ],
            "phrases": [
                ("Ich möchte einen Kaffee, bitte.", "I'd like a coffee, please."),
                ("Haben Sie eine Speisekarte auf Englisch?", "Do you have an English menu?"),
                ("Die Rechnung, bitte.", "The bill, please."),
                ("Ich bin Vegetarier.", "I am vegetarian."),
            ],
        },
        5: {
            "vocab": [
                ("aufwachen", "to wake up"), ("frühstücken", "to have breakfast"),
                ("duschen", "to shower"), ("arbeiten", "to work"),
                ("essen", "to eat"), ("schlafen", "to sleep"), ("studieren", "to study"),
                ("lesen", "to read"),
                ("Morgen", "morning"), ("Nachmittag", "afternoon"), ("Abend", "evening"),
            ],
            "phrases": [
                ("Ich wache um sieben Uhr auf.", "I wake up at seven."),
                ("Ich arbeite von neun bis fünf.", "I work from nine to five."),
                ("Am Nachmittag lerne ich Deutsch.", "In the afternoon I study German."),
                ("Ich gehe um elf Uhr ins Bett.", "I go to bed at eleven."),
            ],
        },
        6: {
            "vocab": [
                ("Flughafen", "airport"), ("Hotel", "hotel"), ("Bahnhof", "station"),
                ("Straße", "street"), ("Karte", "map"), ("rechts", "right"),
                ("links", "left"), ("nah", "near"), ("weit", "far"),
                ("Zimmer", "room"),
            ],
            "phrases": [
                ("Wo ist der Bahnhof?", "Where is the station?"),
                ("Biegen Sie rechts ab.", "Turn right."),
                ("Ich möchte ein Zimmer reservieren.", "I would like to book a room."),
                ("Wie viel kostet das?", "How much does it cost?"),
            ],
        },
        7: {
            "vocab": [
                ("gestern", "yesterday"), ("heute", "today"), ("morgen", "tomorrow"),
                ("letzte Woche", "last week"), ("nächstes Jahr", "next year"),
                ("ich bin gegangen", "I went"), ("ich habe gegessen", "I ate"),
                ("ich habe gemacht", "I did"),
                ("ich werde gehen", "I will go"), ("ich werde machen", "I will do"),
            ],
            "phrases": [
                ("Gestern bin ich ins Kino gegangen.", "Yesterday I went to the cinema."),
                ("Morgen reise ich nach Berlin.", "Tomorrow I'll travel to Berlin."),
                ("Letzte Woche habe ich Maria gesehen.", "Last week I saw Maria."),
                ("Nächstes Jahr lerne ich Französisch.", "Next year I'll learn French."),
            ],
        },
        8: {
            "vocab": [
                ("ich denke, dass", "I think that"), ("ich mag", "I like"),
                ("ich mag nicht", "I don't like"), ("ich bevorzuge", "I prefer"),
                ("ich stimme zu", "I agree"), ("glücklich", "happy"),
                ("traurig", "sad"), ("wütend", "angry"), ("müde", "tired"),
                ("aufgeregt", "excited"),
            ],
            "phrases": [
                ("Ich denke, das ist eine gute Idee.", "I think it's a good idea."),
                ("Ich mag Musik sehr.", "I really like music."),
                ("Ich bin heute ein bisschen müde.", "I'm a bit tired today."),
                ("Was denkst du?", "What do you think?"),
            ],
        },
        9: {
            "vocab": [
                ("obwohl", "although"), ("jedoch", "however"),
                ("deshalb", "therefore"), ("außerdem", "moreover"),
                ("trotz", "despite"), ("während", "while"),
                ("bezüglich", "regarding"), ("tatsächlich", "in fact"),
            ],
            "phrases": [
                ("Obwohl es regnet, gehe ich raus.", "Although it's raining, I'm going out."),
                ("Ich möchte mit dem Manager sprechen.", "I'd like to speak with the manager."),
                ("Könnten Sie das wiederholen, bitte?", "Could you repeat, please?"),
                ("Ich bin nicht sicher, lass mich denken.", "I'm not sure, let me think."),
            ],
        },
        10: {
            "vocab": [
                ("auf Wolke sieben sein", "to be on cloud nine"),
                ("jemanden auf den Arm nehmen", "to pull someone's leg"),
                ("Tomaten auf den Augen haben", "to be blind to something"),
                ("ein Vermögen kosten", "to cost a fortune"),
                ("ein Kinderspiel sein", "to be a piece of cake"),
                ("das Eis brechen", "to break the ice"),
            ],
            "phrases": [
                ("Diese Prüfung war ein Kinderspiel.", "That exam was a piece of cake."),
                ("Nimm mich nicht auf den Arm!", "Don't pull my leg!"),
                ("Das Auto kostet ein Vermögen.", "The car costs a fortune."),
                ("Wir sollten das Eis brechen.", "We should break the ice."),
            ],
        },
    },
    "en": {
        1: {
            "vocab": [
                ("hello", "ciao/hola/bonjour"), ("goodbye", "addio"), ("yes", "sì"), ("no", "no"),
                ("please", "per favore"), ("thank you", "grazie"), ("sorry", "scusa"),
                ("good morning", "buongiorno"), ("good night", "buonanotte"),
                ("I", "io"), ("you", "tu"), ("he", "lui"), ("she", "lei"),
            ],
            "phrases": [
                ("What's your name?", "Come ti chiami?"),
                ("My name is Anna.", "Mi chiamo Anna."),
                ("Nice to meet you.", "Piacere."),
                ("How are you?", "Come stai?"),
                ("I'm fine, thank you.", "Sto bene, grazie."),
            ],
        },
        2: {
            "vocab": [
                ("one", "uno"), ("two", "due"), ("three", "tre"), ("four", "quattro"),
                ("five", "cinque"), ("six", "sei"), ("seven", "sette"), ("eight", "otto"),
                ("nine", "nove"), ("ten", "dieci"),
                ("red", "rosso"), ("blue", "blu"), ("green", "verde"), ("yellow", "giallo"),
                ("white", "bianco"), ("black", "nero"),
            ],
            "phrases": [
                ("I am five years old.", "Ho cinque anni."),
                ("The sky is blue.", "Il cielo è blu."),
                ("My favorite color is green.", "Il mio colore preferito è il verde."),
                ("There are three apples.", "Ci sono tre mele."),
            ],
        },
        3: {
            "vocab": [
                ("mother", "madre"), ("father", "padre"), ("brother", "fratello"),
                ("sister", "sorella"), ("son", "figlio"), ("daughter", "figlia"),
                ("grandfather", "nonno"), ("grandmother", "nonna"),
                ("friend", "amico"), ("family", "famiglia"),
            ],
            "phrases": [
                ("I have two brothers.", "Ho due fratelli."),
                ("My mother is a teacher.", "Mia madre è insegnante."),
                ("I live with my family.", "Vivo con la mia famiglia."),
                ("My best friend is John.", "Il mio migliore amico è John."),
            ],
        },
        4: {
            "vocab": [
                ("water", "acqua"), ("bread", "pane"), ("coffee", "caffè"), ("tea", "tè"),
                ("milk", "latte"), ("wine", "vino"), ("beer", "birra"),
                ("apple", "mela"), ("cheese", "formaggio"), ("meat", "carne"),
                ("fish", "pesce"), ("rice", "riso"),
            ],
            "phrases": [
                ("I'd like a coffee, please.", "Vorrei un caffè, per favore."),
                ("Do you have a menu in English?", "Avete un menù in inglese?"),
                ("The bill, please.", "Il conto, per favore."),
                ("I am vegetarian.", "Sono vegetariano."),
            ],
        },
        5: {
            "vocab": [
                ("to wake up", "svegliarsi"), ("to have breakfast", "fare colazione"),
                ("to shower", "farsi la doccia"), ("to work", "lavorare"),
                ("to eat", "mangiare"), ("to sleep", "dormire"), ("to study", "studiare"),
                ("to read", "leggere"),
                ("morning", "mattina"), ("afternoon", "pomeriggio"), ("evening", "sera"),
            ],
            "phrases": [
                ("I wake up at seven.", "Mi sveglio alle sette."),
                ("I work from nine to five.", "Lavoro dalle nove alle cinque."),
                ("In the afternoon I study English.", "Il pomeriggio studio inglese."),
                ("I go to bed at eleven.", "Vado a letto alle undici."),
            ],
        },
        6: {
            "vocab": [
                ("airport", "aeroporto"), ("hotel", "hotel"), ("station", "stazione"),
                ("street", "strada"), ("map", "mappa"), ("right", "destra"),
                ("left", "sinistra"), ("near", "vicino"), ("far", "lontano"),
                ("room", "camera"),
            ],
            "phrases": [
                ("Where is the station?", "Dov'è la stazione?"),
                ("Turn right.", "Giri a destra."),
                ("I would like to book a room.", "Vorrei prenotare una camera."),
                ("How much does it cost?", "Quanto costa?"),
            ],
        },
        7: {
            "vocab": [
                ("yesterday", "ieri"), ("today", "oggi"), ("tomorrow", "domani"),
                ("last week", "la settimana scorsa"), ("next year", "l'anno prossimo"),
                ("I went", "sono andato"), ("I ate", "ho mangiato"), ("I did", "ho fatto"),
                ("I will go", "andrò"), ("I will do", "farò"),
            ],
            "phrases": [
                ("Yesterday I went to the cinema.", "Ieri sono andato al cinema."),
                ("Tomorrow I will travel.", "Domani viaggerò."),
                ("Last week I saw Maria.", "La settimana scorsa ho visto Maria."),
                ("Next year I'll learn French.", "L'anno prossimo imparerò il francese."),
            ],
        },
        8: {
            "vocab": [
                ("I think that", "penso che"), ("I like", "mi piace"),
                ("I don't like", "non mi piace"), ("I prefer", "preferisco"),
                ("I agree", "sono d'accordo"), ("happy", "felice"),
                ("sad", "triste"), ("angry", "arrabbiato"), ("tired", "stanco"),
                ("excited", "emozionato"),
            ],
            "phrases": [
                ("I think it's a good idea.", "Penso che sia una buona idea."),
                ("I really like music.", "Mi piace molto la musica."),
                ("I'm a bit tired today.", "Sono un po' stanco oggi."),
                ("What do you think?", "Cosa ne pensi?"),
            ],
        },
        9: {
            "vocab": [
                ("although", "anche se"), ("however", "tuttavia"),
                ("therefore", "quindi"), ("moreover", "inoltre"),
                ("despite", "nonostante"), ("while", "mentre"),
                ("regarding", "riguardo a"), ("in fact", "infatti"),
            ],
            "phrases": [
                ("Although it's raining, I'll go out.", "Anche se piove, esco."),
                ("I'd like to speak with the manager.", "Vorrei parlare con il direttore."),
                ("Could you repeat, please?", "Potrebbe ripetere, per favore?"),
                ("I'm not sure, let me think.", "Non sono sicuro, fammi pensare."),
            ],
        },
        10: {
            "vocab": [
                ("to be on cloud nine", "essere al settimo cielo"),
                ("to pull someone's leg", "prendere in giro"),
                ("to break the ice", "rompere il ghiaccio"),
                ("to cost an arm and a leg", "costare un occhio della testa"),
                ("piece of cake", "gioco da ragazzi"),
                ("to hit the nail on the head", "dare nel segno"),
            ],
            "phrases": [
                ("That exam was a piece of cake.", "Quell'esame è stato un gioco da ragazzi."),
                ("Don't pull my leg!", "Non prendermi in giro!"),
                ("I'm on cloud nine!", "Sono al settimo cielo!"),
                ("Let's break the ice.", "Cerchiamo di rompere il ghiaccio."),
            ],
        },
    },
}

# Placement test questions per language: 10 questions of increasing difficulty
PLACEMENT_TESTS = {
    "es": [
        {"level": 1, "question": "How do you say 'hello' in Spanish?", "options": ["adiós", "hola", "gracias", "por favor"], "correct": 1},
        {"level": 1, "question": "What does 'gracias' mean?", "options": ["please", "sorry", "thank you", "hello"], "correct": 2},
        {"level": 2, "question": "How do you say 'three'?", "options": ["dos", "tres", "cuatro", "cinco"], "correct": 1},
        {"level": 3, "question": "What does 'hermano' mean?", "options": ["sister", "brother", "father", "friend"], "correct": 1},
        {"level": 4, "question": "How do you order coffee?", "options": ["Quiero un té", "Quiero un café", "Quiero agua", "Quiero pan"], "correct": 1},
        {"level": 5, "question": "Complete: 'Yo ___ a las siete.'", "options": ["come", "duermo", "me despierto", "trabajo"], "correct": 2},
        {"level": 6, "question": "How do you ask 'Where is the station?'", "options": ["¿Cuándo es?", "¿Dónde está la estación?", "¿Quién es?", "¿Cómo está?"], "correct": 1},
        {"level": 7, "question": "Choose the past tense of 'voy' (I go):", "options": ["iré", "voy", "fui", "iba"], "correct": 2},
        {"level": 8, "question": "Which expresses preference?", "options": ["Estoy cansado", "Prefiero el té", "Hace frío", "Hablo español"], "correct": 1},
        {"level": 10, "question": "What does 'pan comido' mean idiomatically?", "options": ["eaten bread", "very easy", "hungry", "delicious"], "correct": 1},
    ],
    "it": [
        {"level": 1, "question": "How do you say 'hello/bye' in Italian?", "options": ["grazie", "ciao", "scusa", "prego"], "correct": 1},
        {"level": 1, "question": "What does 'grazie' mean?", "options": ["please", "thank you", "sorry", "yes"], "correct": 1},
        {"level": 2, "question": "How do you say 'four'?", "options": ["tre", "cinque", "quattro", "sei"], "correct": 2},
        {"level": 3, "question": "What does 'sorella' mean?", "options": ["brother", "sister", "mother", "friend"], "correct": 1},
        {"level": 4, "question": "How do you say 'I'd like a coffee'?", "options": ["Voglio un tè", "Vorrei un caffè", "Bevo acqua", "Mangio pane"], "correct": 1},
        {"level": 5, "question": "Complete: 'Mi ___ alle sette.'", "options": ["mangio", "dormo", "sveglio", "lavoro"], "correct": 2},
        {"level": 6, "question": "How do you ask 'Where is the station?'", "options": ["Quando è?", "Dov'è la stazione?", "Chi è?", "Come stai?"], "correct": 1},
        {"level": 7, "question": "Past tense of 'vado' (I go):", "options": ["andrò", "vado", "sono andato", "andavo"], "correct": 2},
        {"level": 8, "question": "Which expresses preference?", "options": ["Sono stanco", "Preferisco il tè", "Fa freddo", "Parlo italiano"], "correct": 1},
        {"level": 10, "question": "What does 'gioco da ragazzi' mean?", "options": ["children's game", "very easy", "playful", "young people"], "correct": 1},
    ],
    "fr": [
        {"level": 1, "question": "How do you say 'hello' in French?", "options": ["au revoir", "bonjour", "merci", "pardon"], "correct": 1},
        {"level": 1, "question": "What does 'merci' mean?", "options": ["please", "sorry", "thank you", "yes"], "correct": 2},
        {"level": 2, "question": "How do you say 'five'?", "options": ["quatre", "cinq", "six", "trois"], "correct": 1},
        {"level": 3, "question": "What does 'frère' mean?", "options": ["sister", "brother", "father", "friend"], "correct": 1},
        {"level": 4, "question": "How do you order coffee?", "options": ["Je veux du thé", "Je voudrais un café", "Je bois de l'eau", "Je mange du pain"], "correct": 1},
        {"level": 5, "question": "Complete: 'Je me ___ à sept heures.'", "options": ["mange", "dors", "réveille", "travaille"], "correct": 2},
        {"level": 6, "question": "How do you ask 'Where is the station?'", "options": ["Quand est-ce?", "Où est la gare?", "Qui est-ce?", "Comment ça va?"], "correct": 1},
        {"level": 7, "question": "Past tense of 'je vais' (I go):", "options": ["j'irai", "je vais", "je suis allé", "j'allais"], "correct": 2},
        {"level": 8, "question": "Which expresses preference?", "options": ["Je suis fatigué", "Je préfère le thé", "Il fait froid", "Je parle français"], "correct": 1},
        {"level": 10, "question": "What does 'c'est du gâteau' mean?", "options": ["it's cake", "it's easy", "it's tasty", "it's sweet"], "correct": 1},
    ],
    "de": [
        {"level": 1, "question": "How do you say 'hello' in German?", "options": ["tschüss", "hallo", "danke", "bitte"], "correct": 1},
        {"level": 1, "question": "What does 'danke' mean?", "options": ["please", "thank you", "sorry", "yes"], "correct": 1},
        {"level": 2, "question": "How do you say 'six'?", "options": ["fünf", "sechs", "sieben", "vier"], "correct": 1},
        {"level": 3, "question": "What does 'Schwester' mean?", "options": ["brother", "sister", "mother", "friend"], "correct": 1},
        {"level": 4, "question": "How do you order coffee?", "options": ["Ich will Tee", "Ich möchte einen Kaffee", "Ich trinke Wasser", "Ich esse Brot"], "correct": 1},
        {"level": 5, "question": "Complete: 'Ich ___ um sieben Uhr auf.'", "options": ["esse", "schlafe", "wache", "arbeite"], "correct": 2},
        {"level": 6, "question": "How do you ask 'Where is the station?'", "options": ["Wann ist es?", "Wo ist der Bahnhof?", "Wer ist das?", "Wie geht es?"], "correct": 1},
        {"level": 7, "question": "Past tense of 'ich gehe' (I go):", "options": ["ich werde gehen", "ich gehe", "ich bin gegangen", "ich ging"], "correct": 2},
        {"level": 8, "question": "Which expresses preference?", "options": ["Ich bin müde", "Ich bevorzuge Tee", "Es ist kalt", "Ich spreche Deutsch"], "correct": 1},
        {"level": 10, "question": "What does 'ein Kinderspiel' mean idiomatically?", "options": ["a children's game", "very easy", "playful", "noisy"], "correct": 1},
    ],
    "en": [
        {"level": 1, "question": "How do you say 'thank you' in English?", "options": ["please", "thank you", "sorry", "yes"], "correct": 1},
        {"level": 1, "question": "What is 'goodbye' in English?", "options": ["goodbye", "good night", "good morning", "hi"], "correct": 0},
        {"level": 2, "question": "How do you say the number '7'?", "options": ["six", "seven", "eight", "nine"], "correct": 1},
        {"level": 3, "question": "What does 'sister' mean?", "options": ["brother", "female sibling", "mother", "aunt"], "correct": 1},
        {"level": 4, "question": "How do you order coffee?", "options": ["I want tea", "I'd like a coffee", "I drink water", "I eat bread"], "correct": 1},
        {"level": 5, "question": "Complete: 'I ___ up at seven.'", "options": ["eat", "sleep", "wake", "work"], "correct": 2},
        {"level": 6, "question": "How do you ask 'Where is the station?'", "options": ["When is it?", "Where is the station?", "Who is it?", "How are you?"], "correct": 1},
        {"level": 7, "question": "Past tense of 'go':", "options": ["will go", "go", "went", "going"], "correct": 2},
        {"level": 8, "question": "Which expresses preference?", "options": ["I'm tired", "I prefer tea", "It's cold", "I speak English"], "correct": 1},
        {"level": 10, "question": "What does 'piece of cake' mean idiomatically?", "options": ["a slice of cake", "very easy", "delicious", "small portion"], "correct": 1},
    ],
}


def build():
    output = {}
    for lang_code, levels_content in LANGUAGE_CONTENT.items():
        levels = []
        for topic in LEVEL_TOPICS:
            lid = topic["id"]
            content = levels_content.get(lid, {"vocab": [], "phrases": []})
            levels.append({
                "id": lid,
                "name": topic["name"],
                "icon": topic["icon"],
                "desc": topic["desc"],
                "vocab": [{"target": v[0], "translation": v[1]} for v in content["vocab"]],
                "phrases": [{"target": p[0], "translation": p[1]} for p in content["phrases"]],
            })
        output[lang_code] = {
            "language_code": lang_code,
            "levels": levels,
            "placement_test": PLACEMENT_TESTS.get(lang_code, []),
        }

    out_path = os.path.join(os.path.dirname(__file__), "data", "lessons.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"Built lessons.json with {len(output)} languages, 10 levels each")


if __name__ == "__main__":
    build()
