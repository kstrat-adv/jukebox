/* Sample albums for demo mode (used only when config.js has no apiUrl).
   id | artist | sort name | title | first released | this CD pressed | genres | styles | label | tracks (';' between songs, '##' between discs) */
(function () {
const RAW = `
a01|Fleetwood Mac|Fleetwood Mac|Rumours|1977|1987|Rock|Soft Rock, Pop Rock|Warner Bros.|Second Hand News;Dreams;Never Going Back Again;Don't Stop;Go Your Own Way;Songbird;The Chain;You Make Loving Fun;I Don't Want to Know;Oh Daddy;Gold Dust Woman
a02|Eagles|Eagles|Hotel California|1976|1989|Rock|Soft Rock, Country Rock|Asylum|Hotel California;New Kid in Town;Life in the Fast Lane;Wasted Time;Wasted Time (Reprise);Victim of Love;Pretty Maids All in a Row;Try and Love Again;The Last Resort
a03|Pink Floyd|Pink Floyd|The Dark Side of the Moon|1973|1994|Rock|Prog Rock, Psychedelic Rock|Harvest|Speak to Me;Breathe;On the Run;Time;The Great Gig in the Sky;Money;Us and Them;Any Colour You Like;Brain Damage;Eclipse
a04|Led Zeppelin|Led Zeppelin|Led Zeppelin IV|1971|1994|Rock|Hard Rock, Blues Rock|Atlantic|Black Dog;Rock and Roll;The Battle of Evermore;Stairway to Heaven;Misty Mountain Hop;Four Sticks;Going to California;When the Levee Breaks
a05|Derek and the Dominos|Derek and the Dominos|Layla and Other Assorted Love Songs|1970|1990|Rock, Blues|Blues Rock|Polydor|I Looked Away;Bell Bottom Blues;Keep On Growing;Nobody Knows You When You're Down and Out;I Am Yours;Anyday;Key to the Highway##Tell the Truth;Why Does Love Got to Be So Sad?;Have You Ever Loved a Woman;Little Wing;It's Too Late;Layla;Thorn Tree in the Garden
a06|The Beatles|Beatles, The|Abbey Road|1969|1987|Rock, Pop|Pop Rock|Apple|Come Together;Something;Maxwell's Silver Hammer;Oh! Darling;Octopus's Garden;I Want You (She's So Heavy);Here Comes the Sun;Because;You Never Give Me Your Money;Sun King;Mean Mr. Mustard;Polythene Pam;She Came In Through the Bathroom Window;Golden Slumbers;Carry That Weight;The End;Her Majesty
a07|Marvin Gaye|Gaye, Marvin|What's Going On|1971|1998|Funk & Soul|Soul|Tamla|What's Going On;What's Happening Brother;Flyin' High (In the Friendly Sky);Save the Children;God Is Love;Mercy Mercy Me (The Ecology);Right On;Wholy Holy;Inner City Blues (Make Me Wanna Holler)
a08|Stevie Wonder|Wonder, Stevie|Innervisions|1973|2000|Funk & Soul|Soul, Funk|Tamla|Too High;Visions;Living for the City;Golden Lady;Higher Ground;Jesus Children of America;All in Love Is Fair;Don't You Worry 'bout a Thing;He's Misstra Know-It-All
a09|Carole King|King, Carole|Tapestry|1971|1999|Pop, Folk|Soft Rock|Ode|I Feel the Earth Move;So Far Away;It's Too Late;Home Again;Beautiful;Way Over Yonder;You've Got a Friend;Where You Lead;Will You Love Me Tomorrow?;Smackwater Jack;Tapestry;(You Make Me Feel Like) A Natural Woman
a10|Miles Davis|Davis, Miles|Kind of Blue|1959|1997|Jazz|Modal, Cool Jazz|Columbia|So What;Freddie Freeloader;Blue in Green;All Blues;Flamenco Sketches
a11|The Dave Brubeck Quartet|Brubeck, Dave|Time Out|1959|1997|Jazz|Cool Jazz|Columbia|Blue Rondo à la Turk;Strange Meadow Lark;Take Five;Three to Get Ready;Kathy's Waltz;Everybody's Jumpin';Pick Up Sticks
a12|Michael Jackson|Jackson, Michael|Thriller|1982|2001|Pop, Funk & Soul|Disco, Pop Rock|Epic|Wanna Be Startin' Somethin';Baby Be Mine;The Girl Is Mine;Thriller;Beat It;Billie Jean;Human Nature;P.Y.T. (Pretty Young Thing);The Lady in My Life
a13|Bruce Springsteen|Springsteen, Bruce|Born to Run|1975|1985|Rock|Classic Rock|Columbia|Thunder Road;Tenth Avenue Freeze-Out;Night;Backstreets;Born to Run;She's the One;Meeting Across the River;Jungleland
a14|Prince and the Revolution|Prince|Purple Rain|1984|1984|Pop, Rock, Funk & Soul|Synth-pop, Funk|Warner Bros.|Let's Go Crazy;Take Me with U;The Beautiful Ones;Computer Blue;Darling Nikki;When Doves Cry;I Would Die 4 U;Baby I'm a Star;Purple Rain
a15|Paul Simon|Simon, Paul|Graceland|1986|1986|Pop, World|Pop Rock, Mbaqanga|Warner Bros.|The Boy in the Bubble;Graceland;I Know What I Know;Gumboots;Diamonds on the Soles of Her Shoes;You Can Call Me Al;Under African Skies;Homeless;Crazy Love, Vol. II;That Was Your Mother;All Around the World or the Myth of Fingerprints
a16|U2|U2|The Joshua Tree|1987|1987|Rock|Pop Rock|Island|Where the Streets Have No Name;I Still Haven't Found What I'm Looking For;With or Without You;Bullet the Blue Sky;Running to Stand Still;Red Hill Mining Town;In God's Country;Trip Through Your Wires;One Tree Hill;Exit;Mothers of the Disappeared
a17|Dire Straits|Dire Straits|Brothers in Arms|1985|1985|Rock|Pop Rock|Vertigo|So Far Away;Money for Nothing;Walk of Life;Your Latest Trick;Why Worry;Ride Across the River;The Man's Too Strong;One World;Brothers in Arms
a18|Nirvana|Nirvana|Nevermind|1991|1991|Rock|Grunge|DGC|Smells Like Teen Spirit;In Bloom;Come as You Are;Breed;Lithium;Polly;Territorial Pissings;Drain You;Lounge Act;Stay Away;On a Plain;Something in the Way
a19|R.E.M.|R.E.M.|Automatic for the People|1992|1992|Rock|Alternative Rock|Warner Bros.|Drive;Try Not to Breathe;The Sidewinder Sleeps Tonite;Everybody Hurts;New Orleans Instrumental No. 1;Sweetness Follows;Monty Got a Raw Deal;Ignoreland;Star Me Kitten;Man on the Moon;Nightswimming;Find the River
a20|Johnny Cash|Cash, Johnny|At Folsom Prison|1968|1988|Country|Country|Columbia|Folsom Prison Blues;Dark as the Dungeon;I Still Miss Someone;Cocaine Blues;25 Minutes to Go;Orange Blossom Special;The Long Black Veil;Send a Picture of Mother;The Wall;Dirty Old Egg-Sucking Dog;Flushed from the Bathroom of Your Heart;Jackson;Give My Love to Rose;I Got Stripes;Green, Green Grass of Home;Greystone Chapel
a21|Patsy Cline|Cline, Patsy|12 Greatest Hits|1967|1988|Country|Countrypolitan|MCA|Walkin' After Midnight;Sweet Dreams (Of You);Crazy;I Fall to Pieces;So Wrong;Strange;Back in Baby's Arms;She's Got You;Faded Love;Why Can't He Be You;You're Stronger Than Me;Leavin' on Your Mind
a22|Creedence Clearwater Revival|Creedence Clearwater Revival|Chronicle: The 20 Greatest Hits|1976|1987|Rock|Swamp Rock, Classic Rock|Fantasy|Susie Q;I Put a Spell on You;Proud Mary;Bad Moon Rising;Lodi;Green River;Commotion;Down on the Corner;Fortunate Son;Travelin' Band;Who'll Stop the Rain;Up Around the Bend;Run Through the Jungle;Lookin' Out My Back Door;Long as I Can See the Light;I Heard It Through the Grapevine;Have You Ever Seen the Rain?;Hey Tonight;Sweet Hitch-Hiker;Someday Never Comes
a23|Steely Dan|Steely Dan|Aja|1977|1999|Jazz, Rock|Jazz-Rock|ABC|Black Cow;Aja;Deacon Blues;Peg;Home at Last;I Got the News;Josie
a24|Simon & Garfunkel|Simon & Garfunkel|Bridge over Troubled Water|1970|2001|Folk, Pop|Folk Rock|Columbia|Bridge over Troubled Water;El Condor Pasa (If I Could);Cecilia;Keep the Customer Satisfied;So Long, Frank Lloyd Wright;The Boxer;Baby Driver;The Only Living Boy in New York;Why Don't You Write Me;Bye Bye Love;Song for the Asking
a25|The Rolling Stones|Rolling Stones, The|Let It Bleed|1969|2002|Rock|Blues Rock|ABKCO|Gimme Shelter;Love in Vain;Country Honk;Live with Me;Let It Bleed;Midnight Rambler;You Got the Silver;Monkey Man;You Can't Always Get What You Want
a26|Aretha Franklin|Franklin, Aretha|I Never Loved a Man the Way I Love You|1967|1995|Funk & Soul|Soul|Atlantic|Respect;Drown in My Own Tears;I Never Loved a Man (The Way I Love You);Soul Serenade;Don't Let Me Lose This Dream;Baby, Baby, Baby;Dr. Feelgood (Love Is a Serious Business);Good Times;Do Right Woman, Do Right Man;Save Me;A Change Is Gonna Come
a27|Ella Fitzgerald & Louis Armstrong|Fitzgerald, Ella|Ella and Louis|1956|1988|Jazz|Vocal, Swing|Verve|Can't We Be Friends?;Isn't This a Lovely Day?;Moonlight in Vermont;They Can't Take That Away from Me;Under a Blanket of Blue;Tenderly;A Foggy Day;Stars Fell on Alabama;Cheek to Cheek;The Nearness of You;April in Paris
a28|Norah Jones|Jones, Norah|Come Away with Me|2002|2002|Jazz, Pop|Vocal, Contemporary Jazz|Blue Note|Don't Know Why;Seven Years;Cold Cold Heart;Feelin' the Same Way;Come Away with Me;Shoot the Moon;Turn Me On;Lonestar;I've Got to See You Again;Painter Song;One Flight Down;Nightingale;The Long Day Is Over;The Nearness of You
a29|Tom Petty|Petty, Tom|Full Moon Fever|1989|1989|Rock|Heartland Rock|MCA|Free Fallin';I Won't Back Down;Love Is a Long Road;A Face in the Crowd;Runnin' Down a Dream;Feel a Whole Lot Better;Yer So Bad;Depending on You;The Apartment Song;Alright for Now;A Mind with a Heart of Its Own;Zombie Zoo
a30|Talking Heads|Talking Heads|Remain in Light|1980|2006|Rock, Funk & Soul|New Wave|Sire|Born Under Punches (The Heat Goes On);Crosseyed and Painless;The Great Curve;Once in a Lifetime;Houses in Motion;Seen and Not Seen;Listening Wind;The Overload
a31|Buena Vista Social Club|Buena Vista Social Club|Buena Vista Social Club|1997|1997|Latin|Son, Bolero|World Circuit|Chan Chan;De Camino a la Vereda;El Cuarto de Tula;Pueblo Nuevo;Dos Gardenias;¿Y Tú Qué Has Hecho?;Veinte Años;El Carretero;Candela;Amor de Loca Juventud;Orgullecida;Murmullo;Buena Vista Social Club;La Bayamesa
a32|Bob Marley & The Wailers|Marley, Bob|Legend|1984|1990|Reggae|Roots Reggae|Island|Is This Love;No Woman, No Cry;Could You Be Loved;Three Little Birds;Buffalo Soldier;Get Up, Stand Up;Stir It Up;One Love / People Get Ready;I Shot the Sheriff;Waiting in Vain;Redemption Song;Satisfy My Soul;Exodus;Jamming
a33|Joni Mitchell|Mitchell, Joni|Blue|1971|1987|Folk, Pop|Folk|Reprise|All I Want;My Old Man;Little Green;Carey;Blue;California;This Flight Tonight;River;A Case of You;The Last Time I Saw Richard
a34|The Beach Boys|Beach Boys, The|Pet Sounds|1966|1990|Rock, Pop|Pop Rock|Capitol|Wouldn't It Be Nice;You Still Believe in Me;That's Not Me;Don't Talk (Put Your Head on My Shoulder);I'm Waiting for the Day;Let's Go Away for Awhile;Sloop John B;God Only Knows;I Know There's an Answer;Here Today;I Just Wasn't Made for These Times;Pet Sounds;Caroline, No
a35|AC/DC|AC/DC|Back in Black|1980|2003|Rock|Hard Rock|Atlantic|Hells Bells;Shoot to Thrill;What Do You Do for Money Honey;Given the Dog a Bone;Let Me Put My Love into You;Back in Black;You Shook Me All Night Long;Have a Drink on Me;Shake a Leg;Rock and Roll Ain't Noise Pollution
`;
const TAG_VOCAB = ['Party', 'Dancing', 'Dinner', 'Sunday morning', 'Road trip', 'Late night'];
const INITIAL_TAGS = {
  a01: ['Road trip', 'Sunday morning'], a02: ['Road trip'], a03: ['Late night'], a05: ['Late night'],
  a06: ['Sunday morning'], a07: ['Dinner', 'Sunday morning'], a08: ['Dancing'], a09: ['Sunday morning'],
  a10: ['Late night', 'Dinner'], a11: ['Dinner'], a12: ['Party', 'Dancing'], a13: ['Road trip'],
  a14: ['Party', 'Dancing'], a15: ['Road trip', 'Dancing'], a16: ['Road trip'], a17: ['Road trip'],
  a19: ['Late night'], a20: ['Road trip'], a21: ['Sunday morning'], a22: ['Party', 'Road trip'],
  a23: ['Late night'], a24: ['Sunday morning'], a25: ['Party'], a26: ['Dinner'], a27: ['Dinner', 'Sunday morning'],
  a28: ['Sunday morning'], a29: ['Road trip'], a30: ['Dancing'], a31: ['Dinner'], a32: ['Party', 'Road trip'],
  a33: ['Sunday morning', 'Late night'], a34: ['Road trip'], a35: ['Party'],
};
const INITIAL_SLOTS = [
  [0, 'a01', 1], [1, 'a02', 1], [2, 'a12', 1], [3, 'a06', 1], [4, 'a07', 1], [5, 'a13', 1], [6, 'a32', 1],
  [7, 'a22', 1], [8, 'a35', 1], [9, 'a14', 1], [10, 'a15', 1], [11, 'a09', 1], [12, 'a23', 1], [13, 'a10', 1],
  [14, 'a20', 1], [15, 'a16', 1], [16, 'a17', 1], [17, 'a25', 1], [18, 'a26', 1], [19, 'a31', 1],
  [20, 'a05', 1], [21, 'a05', 2], [22, 'a34', 1], [23, 'a29', 1],
];
window.JUKEBOX_SAMPLE = { raw: RAW, pending: ['a28'], tagVocab: TAG_VOCAB, tags: INITIAL_TAGS, slots: INITIAL_SLOTS };
})();
